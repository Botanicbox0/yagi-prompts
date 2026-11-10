import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §4 — `/api/brand-rooms/messages` and `/summary` over HTTP: status codes per refusal,
 * the same-origin rule, answers that are private and uncached, and the team notice scheduled after the
 * answer for a brand member's new line only (best effort: a notifier that throws changes nothing the
 * customer sees).
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

const route = await import('@/app/api/brand-rooms/messages/route');
const summary = await import('@/app/api/brand-rooms/summary/route');
const BASE = 'http://localhost:3000/api/brand-rooms/messages';
const get = (query: string) => route.GET(new NextRequest(`${BASE}?${query}`));
const post = (operation: string, input: unknown, headers: Record<string, string> = {}) =>
  route.POST(new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ operation, input }) }));

let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
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

const send = (body: string, extra: Record<string, unknown> = {}) =>
  post('message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body, ...extra });

describe('/api/brand-rooms/messages', () => {
  it('sends, reads back and answers private and uncached', async () => {
    const sent = await send('Hello team');
    expect(sent.status).toBe(201);
    expect(sent.headers.get('cache-control')).toBe('private, no-store');
    const id = (await sent.json()).message.id;
    const page = await get(`organizationId=${f.orgId}&projectId=${f.projectId}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const body = await page.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([id]);
    expect(body.cursor).toMatch(/^\d{4}-\d\d-\d\dT/);
    const poll = await get(`organizationId=${f.orgId}&projectId=${f.projectId}&since=${encodeURIComponent(body.cursor)}`);
    expect(poll.status).toBe(200);
  });

  it('tells the team after the answer, once per new brand line, and never fails the send', async () => {
    const requestId = randomUUID();
    expect((await send('Can you call me?', { requestId, mentionsTeam: true })).status).toBe(201);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(1);
    mocks.notify.mockRejectedValueOnce(new Error('notifier down'));
    await mocks.after[0]!();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const notice = (mocks.notify.mock.calls[0] as unknown as [unknown, { organizationId: string; body: string }])[1];
    expect(notice.organizationId).toBe(f.orgId);
    expect(notice.body).toContain('Spring launch');
    expect(notice.body).toContain('야기 팀 호출');
    expect(notice.body).toContain(`/admin/brand-rooms/${f.orgId}?channel=${f.projectId}`);
    // The same request again is the same line: 200, no second notice.
    expect((await send('Can you call me?', { requestId })).status).toBe(200);
    expect(mocks.after).toHaveLength(1);
    // Reads and reactions tell nobody.
    expect((await post('channel.read', { organizationId: f.orgId, projectId: f.projectId })).status).toBe(200);
    expect(mocks.after).toHaveLength(1);
  });

  it('maps refusals to status codes', async () => {
    expect((await get(`organizationId=not-a-uuid&projectId=${f.projectId}`)).status).toBe(400);
    expect((await post('message.nope', { organizationId: f.orgId, projectId: f.projectId })).status).toBe(400);
    expect((await send('')).status).toBe(400);
    const line = (await (await send('mine')).json()).message.id;
    mocks.viewer = viewerOf(f.ids.editor);
    expect((await post('message.edit', { organizationId: f.orgId, projectId: f.projectId, messageId: line, body: 'not yours' })).status).toBe(403);
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await get(`organizationId=${f.orgId}&projectId=${f.projectId}`)).status).toBe(404);
    mocks.viewer = null;
    expect((await get(`organizationId=${f.orgId}&projectId=${f.projectId}`)).status).toBe(401);
    expect((await send('x')).status).toBe(401);
  });

  it('rate-limits at twenty lines a minute with a 429', async () => {
    for (let i = 0; i < 20; i += 1) expect((await send(`line ${i}`)).status).toBe(201);
    expect((await send('one too many')).status).toBe(429);
  });

  it('refuses a cross-site post before anything else and a body that is too big', async () => {
    const cross = await post('message.send', { organizationId: f.orgId }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    const huge = await route.POST(
      new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'message.send', input: { body: 'x'.repeat(40_000) } }) }),
    );
    expect(huge.status).toBe(413);
  });

  it('is closed while the flag is off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const closed = await get(`organizationId=${f.orgId}&projectId=${f.projectId}`);
    expect(closed.status).toBe(404);
    expect(await closed.json()).toEqual({ ok: false, code: 'rooms_closed' });
    expect((await send('x')).status).toBe(404);
  });
});

describe('/api/brand-rooms/summary', () => {
  it('returns every channel this person may open with unread counts', async () => {
    await send('one');
    mocks.viewer = viewerOf(f.ids.viewer);
    const response = await summary.GET(new NextRequest(`http://localhost:3000/api/brand-rooms/summary?organizationId=${f.orgId}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, unread: 1 });
    expect(body.channels.map((c: { projectId: string | null }) => c.projectId)).toEqual([null, f.projectId]);
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await summary.GET(new NextRequest(`http://localhost:3000/api/brand-rooms/summary?organizationId=${f.orgId}`))).status).toBe(404);
  });
});
