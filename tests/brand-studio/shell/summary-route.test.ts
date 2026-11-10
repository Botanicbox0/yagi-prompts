import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { loadStudioSummary, STUDIO_SETTLED_WINDOW_MS } from '@/lib/brand-studio/summary';
import { studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §3 — `GET /api/brand-studio/summary`, the rail's credits and background jobs.
 * Same gates as `GET /api/brand-studio`: flag, sign-in, membership, the Morphic hardline (by id and by
 * name) and the generative-media policy, all before anything about the organization is read.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));

const route = await import('@/app/api/brand-studio/summary/route');
const get = (organizationId: string) => route.GET(new NextRequest(`http://localhost:3000/api/brand-studio/summary?organizationId=${organizationId}`));

let f: StudioFixture | null = null;
beforeEach(() => {
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

async function job(
  sql: SqlRunner,
  orgId: string,
  by: string | null,
  options: { kind?: string; status?: string; finishedAgoMs?: number; createdAt?: Date; estimate?: number; usage?: number | null } = {},
): Promise<string> {
  const status = options.status ?? 'running';
  const finished = ['succeeded', 'failed', 'canceled'].includes(status) ? new Date(Date.now() - (options.finishedAgoMs ?? 1000)).toISOString() : null;
  return (
    await sql.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, estimate_krw, usage_krw, created_at, finished_at)
        values ($1, $2, $3, $4, $5, 'seedream-5-pro', $6, $7, $8, $9) returning id`,
      [
        orgId,
        by,
        `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        options.kind ?? 'image',
        status,
        options.estimate ?? 1000,
        options.usage ?? null,
        (options.createdAt ?? new Date()).toISOString(),
        finished,
      ],
    )
  ).rows[0]!.id;
}

describe('GET /api/brand-studio/summary', () => {
  it('answers the owner with credits, their running jobs and the ones that just finished', async () => {
    f = await studioFixture({ capKrw: 300_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const running = await job(f.sql, f.orgId, f.ids.owner, { kind: 'image', status: 'running' });
    const queued = await job(f.sql, f.orgId, f.ids.owner, { kind: 'video_remix', status: 'queued' });
    const done = await job(f.sql, f.orgId, f.ids.owner, { kind: 'region_edit', status: 'succeeded', finishedAgoMs: 60_000, usage: 900 });
    await job(f.sql, f.orgId, f.ids.owner, { status: 'failed', finishedAgoMs: STUDIO_SETTLED_WINDOW_MS + 60_000 });
    // A teammate's jobs are not "yours".
    await job(f.sql, f.orgId, f.ids.editor, { status: 'running' });
    await job(f.sql, f.orgId, f.ids.editor, { status: 'succeeded', finishedAgoMs: 1000 });

    const response = await get(f.orgId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.allowance.capKrw).toBe(300_000);
    expect(body.allowance.usedKrw).toBeGreaterThan(0);
    expect(body.open.map((j: { id: string }) => j.id).sort()).toEqual([running, queued].sort());
    expect(body.open.find((j: { id: string }) => j.id === queued).kind).toBe('video_remix');
    expect(body.settled).toEqual([{ id: done, kind: 'region_edit', status: 'succeeded', finishedAt: expect.any(String) }]);
    expect(Object.keys(body).sort()).toEqual(['allowance', 'ok', 'open', 'settled']);
  });

  it('answers a viewer (read-only seat) and refuses outsiders and signed-out visitors', async () => {
    f = await studioFixture();
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await get(f.orgId)).status).toBe(200);
    mocks.viewer = viewerOf(f.ids.outsider);
    const outsider = await get(f.orgId);
    expect(outsider.status).toBe(404);
    expect(await outsider.json()).toEqual({ ok: false, code: 'not_found' });
    mocks.viewer = null;
    expect((await get(f.orgId)).status).toBe(401);
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await get('not-a-uuid')).status).toBe(404);
  });

  it('is closed for everyone while the flag is off', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    f = await studioFixture();
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    const response = await get(f.orgId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: 'studio_closed' });
  });

  it('is a GET-only path on the brand host', () => {
    expect(brandRouteAllowed('/api/brand-studio/summary', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/summary', 'POST')).toBe(false);
  });
});

const sandboxed = [...SANDBOXED_CLIENT_ORG_IDS];
describe.each([
  { label: `sandboxed id ${sandboxed[0]}`, orgId: sandboxed[0]! },
  { label: `sandboxed id ${sandboxed[1]}`, orgId: sandboxed[1]! },
  { label: 'named "Morphic Korea"', orgName: 'Morphic Korea' },
  { label: 'named "모픽"', orgName: '모픽' },
])('Morphic hardline: $label', ({ orgId, orgName }) => {
  it('answers 404 that names nothing, even with an allowance and a running job', async () => {
    f = await studioFixture({ orgId, orgName: orgName ?? 'Client brand', capKrw: 5_000_000 });
    mocks.sql = f.sql;
    await job(f.sql, f.orgId, f.ids.owner, { status: 'running' });
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const response = await get(f.orgId);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: 'feature_unavailable' });
    }
  });
});

describe('generative media denied by policy', () => {
  it('answers 404 like a sandboxed client', async () => {
    f = await studioFixture({ capKrw: 5_000_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])`, [f.orgId]);
    const response = await get(f.orgId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('loadStudioSummary', () => {
  it('reads the window from the injected clock', async () => {
    f = await studioFixture();
    const now = new Date();
    const recent = await job(f.sql, f.orgId, f.ids.owner, { status: 'canceled', finishedAgoMs: 5_000 });
    const result = await loadStudioSummary({ sql: f.sql, env: { defaultMonthlyKrw: 0 }, now: () => now }, viewerOf(f.ids.owner), f.orgId);
    expect(result.ok && result.settled.map((j) => [j.id, j.status])).toEqual([[recent, 'canceled']]);
    const later = await loadStudioSummary(
      { sql: f.sql, env: { defaultMonthlyKrw: 0 }, now: () => new Date(now.getTime() + STUDIO_SETTLED_WINDOW_MS + 10_000) },
      viewerOf(f.ids.owner),
      f.orgId,
    );
    expect(later.ok && later.settled).toEqual([]);
  });
});
