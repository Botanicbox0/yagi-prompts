import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { sendTransport, loadSendBell } from '@/components/brand-rooms/chat/transport';
import { as, closeWorld, imageResult, openSend, sendWorld, type SendWorld } from './helpers';

/**
 * 보내기 over HTTP (`POST /api/brand-rooms/messages`, `GET /api/brand-rooms/summary`), and the typed client
 * (`sendTransport`, `loadSendBell`) against the real routes:
 *  - status codes: 200 for an answer, the unknown operation's 400 `invalid` while closed, 404 for a closed organization
 *    or a non-member, 404 `rooms_closed` when rooms are off, 429 for the rate; answers are private and uncached;
 *  - a members line never calls the team's Slack and queues no team notice (the §8.2 table's `message.send` row);
 *  - the summary's `&view=mentions`.
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
const post = (operation: string, input: unknown) =>
  route.POST(new NextRequest(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

/** The browser's fetch, served by the two routes in this process. */
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost:3000');
  const request = new NextRequest(url, init as never);
  return url.pathname.endsWith('/summary') ? summary.GET(request) : route.POST(request);
};

let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
  mocks.after.length = 0;
  mocks.notify.mockReset();
  mocks.sql = w.f.sql;
  mocks.viewer = as(w.f.ids.owner);
});
afterEach(async () => {
  await closeWorld(w);
  mocks.sql = null;
  mocks.viewer = null;
});

const teamNotices = async () => (await w.f.sql.query<{ n: number }>('select count(*)::int as n from team_notice_deliveries')).rows[0]!.n;

describe('POST /api/brand-rooms/messages with send.*', () => {
  it('answers 200, private and uncached; never the team’s Slack, never a team notice', async () => {
    openSend(w.f.orgId);
    const file = (await imageResult(w, w.f.projectId)).outputId;
    const before = await teamNotices();
    const sent = await post('send.post', { organizationId: w.f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: '@editor look', mentions: [w.f.ids.editor] });
    expect(sent.status).toBe(200);
    expect(sent.headers.get('cache-control')).toBe('private, no-store');
    const rootId = (await sent.json()).thread.rootId as string;
    const replied = await post('send.reply', { organizationId: w.f.orgId, requestId: randomUUID(), rootId, body: 'ok' });
    expect(replied.status).toBe(200);
    for (const callback of mocks.after.splice(0)) await callback();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(await teamNotices()).toBe(before);
  });

  it('closed: 400 invalid (the unknown operation’s); rooms off: 404 rooms_closed; outsiders and closed organizations: 404', async () => {
    const file = (await imageResult(w)).outputId;
    const input = { organizationId: w.f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x' };
    vi.stubEnv('BRAND_ROOMS', 'on');
    const unknown = await post('send.nope', input);
    const closed = await post('send.post', input);
    expect([closed.status, await closed.json()]).toEqual([unknown.status, await unknown.json()]);
    expect(closed.status).toBe(400);
    openSend(w.f.orgId);
    vi.stubEnv('BRAND_ROOMS', 'off');
    const off = await post('send.post', input);
    expect([off.status, await off.json()]).toEqual([404, { ok: false, code: 'rooms_closed' }]);
    vi.stubEnv('BRAND_ROOMS', 'on');
    mocks.viewer = as(w.f.ids.outsider);
    expect((await post('send.inbox', { organizationId: w.f.orgId })).status).toBe(404);
    mocks.viewer = null;
    expect((await post('send.inbox', { organizationId: w.f.orgId })).status).toBe(401);
  });
});

describe('the typed client against the routes', () => {
  it('sendTransport: post, reply, thread, file, inbox, read, readAll, people', async () => {
    openSend(w.f.orgId);
    const file = { kind: 'output' as const, outputId: (await imageResult(w, w.f.projectId)).outputId };
    const client = sendTransport(w.f.orgId, fetcher);
    const people = await client.people();
    if (!people.ok) throw new Error(people.code);
    const editorId = people.people.find((p) => p.role === 'editor')!.id;
    const sent = await client.post({ requestId: randomUUID(), file, body: '@editor', mentions: [editorId] });
    if (!sent.ok) throw new Error(sent.code);
    mocks.viewer = as(w.f.ids.editor);
    const inbox = await client.inbox();
    expect(inbox).toMatchObject({ ok: true, view: 'all', unread: 1, mentionsUnread: 1, next: null });
    expect(await client.inbox({ view: 'mentions' })).toMatchObject({ ok: true, view: 'mentions' });
    expect(await client.file(file)).toMatchObject({ ok: true, threads: [{ rootId: sent.thread.rootId }] });
    expect(await client.thread(sent.thread.rootId, { markRead: false })).toMatchObject({ ok: true, thread: { unread: true } });
    expect(await client.reply({ requestId: randomUUID(), rootId: sent.thread.rootId, body: 'On it' })).toMatchObject({ ok: true, message: { body: 'On it' } });
    expect(await client.read(sent.thread.rootId)).toMatchObject({ ok: true, rootId: sent.thread.rootId });
    expect(await client.readAll()).toEqual({ ok: true, marked: 0, more: false });
    expect(await client.thread(randomUUID())).toEqual({ ok: false, code: 'not_found' });
    expect(await sendTransport(w.f.orgId, async () => {
      throw new Error('down');
    }).inbox()).toEqual({ ok: false, code: 'offline' });
  });

  it('loadSendBell: the bell with thread lines, and the "멘션" view', async () => {
    openSend(w.f.orgId);
    const file = { kind: 'output' as const, outputId: (await imageResult(w, w.f.projectId)).outputId };
    const sent = await sendTransport(w.f.orgId, fetcher).post({ requestId: randomUUID(), file, body: '@editor', mentions: [w.f.ids.editor] });
    if (!sent.ok) throw new Error(sent.code);
    mocks.viewer = as(w.f.ids.editor);
    const all = await loadSendBell(w.f.orgId, 'all', fetcher);
    if (!all.ok || !all.bell || !('view' in all.bell)) throw new Error(JSON.stringify(all));
    expect(all.bell.items.some((i) => i.id === `thread:${sent.thread.rootId}`)).toBe(true);
    const mentions = await loadSendBell(w.f.orgId, 'mentions', fetcher);
    if (!mentions.ok || !mentions.bell || !('view' in mentions.bell)) throw new Error(JSON.stringify(mentions));
    expect(mentions.bell.view).toBe('mentions');
    expect(mentions.bell.items.map((i) => i.id)).toEqual([`thread:${sent.thread.rootId}`]);
    expect(mentions.bell.unread).toBe(all.bell.unread);
  });
});
