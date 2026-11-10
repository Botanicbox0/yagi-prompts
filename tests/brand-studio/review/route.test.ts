import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedOutput } from './fixtures';

/**
 * docs/BRAND-STUDIO-V3.md §7 — `/api/brand-studio/review` over HTTP: status codes per refusal, the
 * same-origin rule, and the team notice scheduled after the answer (best effort: a notifier that
 * throws changes nothing the customer sees).
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  after: [] as Array<() => unknown>,
  notify: vi.fn(async () => ({ sent: true })),
}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
vi.mock('@/lib/brands/concierge-slack', () => ({ notifySlackBrandConcierge: mocks.notify }));

const route = await import('@/app/api/brand-studio/review/route');
const BASE = 'http://localhost:3000/api/brand-studio/review';
const get = (query: string) => route.GET(new NextRequest(`${BASE}?${query}`));
const post = (operation: string, input: unknown, headers: Record<string, string> = {}) =>
  route.POST(new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ operation, input }) }));

let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  mocks.after.length = 0;
  mocks.notify.mockReset();
  mocks.notify.mockResolvedValue({ sent: true });
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  mocks.sql = null;
  mocks.viewer = null;
});

async function openReview(): Promise<string> {
  const outputId = await seedOutput(studioDeps(f.sql), f.orgId, f.ids.owner, 'video');
  const response = await post('review.create', { organizationId: f.orgId, outputId, title: 'Spring film' });
  expect(response.status).toBe(201);
  return (await response.json()).review.id;
}

describe('/api/brand-studio/review', () => {
  it('lists, opens one piece and answers private and uncached', async () => {
    const reviewId = await openReview();
    const list = await get(`organizationId=${f.orgId}`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    expect(await list.json()).toMatchObject({ ok: true, canWrite: true, reviews: [{ id: reviewId, kind: 'video' }] });
    const one = await get(`organizationId=${f.orgId}&review=${reviewId}`);
    expect(await one.json()).toMatchObject({ ok: true, review: { id: reviewId, seconds: 6 }, comments: [] });
    expect((await get(`organizationId=${f.orgId}&review=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  it('maps refusals to status codes', async () => {
    const reviewId = await openReview();
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await post('comment.add', { organizationId: f.orgId, reviewId, body: 'hi' })).status).toBe(403);
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await get(`organizationId=${f.orgId}`)).status).toBe(404);
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await post('comment.add', { organizationId: f.orgId, reviewId, body: '' })).status).toBe(400);
    expect((await post('nope.op', { organizationId: f.orgId })).status).toBe(400);
    for (let i = 0; i < 10; i += 1) expect((await post('comment.add', { organizationId: f.orgId, reviewId, body: `n${i}` })).status).toBe(200);
    const limited = await post('comment.add', { organizationId: f.orgId, reviewId, body: 'again' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, code: 'rate_limited' });
    mocks.viewer = null;
    expect((await get(`organizationId=${f.orgId}`)).status).toBe(401);
    expect((await post('comment.add', { organizationId: f.orgId, reviewId, body: 'hi' })).status).toBe(401);
  });

  it('refuses a cross-site post before anything else', async () => {
    const response = await post('review.create', { organizationId: f.orgId }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });

  it('tells the team after the answer about brand notes and status moves, never failing the request', async () => {
    const reviewId = await openReview();
    expect(mocks.after).toHaveLength(0);
    const added = await post('comment.add', { organizationId: f.orgId, reviewId, body: 'Logo smaller please', atMs: 2000 });
    expect(added.status).toBe(200);
    const body = await added.json();
    expect(Object.keys(body).sort()).toEqual(['comment', 'ok']);
    expect(JSON.stringify(body)).not.toMatch(/admin|notice/i);
    expect(mocks.after).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
    await mocks.after[0]!();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const [, notice] = mocks.notify.mock.calls[0] as unknown as [unknown, { organizationId: string; body: string; messageId: string }];
    expect(notice.organizationId).toBe(f.orgId);
    expect(notice.messageId).toBe(body.comment.id);
    expect(notice.body).toContain('Logo smaller please');

    mocks.notify.mockRejectedValueOnce(new Error('notifier down'));
    const moved = await post('review.status', { organizationId: f.orgId, reviewId, status: 'approved' });
    expect(moved.status).toBe(200);
    expect(mocks.after).toHaveLength(2);
    await expect(Promise.resolve(mocks.after[1]!())).resolves.toBeUndefined();

    // Resolving and deleting are not news for the team.
    await post('comment.resolve', { organizationId: f.orgId, reviewId, commentId: body.comment.id });
    expect(mocks.after).toHaveLength(2);
  });

  it('closes with the flag and is reachable on the brand host', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect(await (await get(`organizationId=${f.orgId}`)).json()).toEqual({ ok: false, code: 'studio_closed' });
    expect((await post('review.create', { organizationId: f.orgId })).status).toBe(404);
    expect(brandRouteAllowed('/api/brand-studio/review', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/review', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/review/extra', 'POST')).toBe(false);
  });
});
