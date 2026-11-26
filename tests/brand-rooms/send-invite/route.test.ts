import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { EmailMessage, Mailer } from '@/lib/notify/mailer';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { sendInviteTransport, sendTransport } from '@/components/brand-rooms/chat/transport';
import { as, closeWorld, imageResult, openSend, sendWorld, type SendWorld } from '../send/helpers';
import { openInvites, person } from './helpers';

/**
 * 초대하고 보내기 over HTTP (`POST /api/brand-rooms/messages`, `POST /api/brand-workspace` `invitation.accept`) and the
 * typed client (`sendInviteTransport`) against the real routes:
 *  - statuses: 200, 403 `forbidden` for a viewer, 429 `invite_limit`, 400 `invalid` while closed;
 *  - the route hands the line's mail to the existing mailer after the commit (BRAND_ORG_INVITE_EMAIL on);
 *  - the acceptance route delivers the waiting line (the route gives `acceptBrandInvitation` its hooks);
 *  - `sendTransport` (slice 4a's client) keeps working beside it.
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  verified: new Map<string, string>(),
  after: [] as Array<() => unknown>,
  sent: [] as EmailMessage[],
}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async (userId: string | null | undefined) => (userId ? mocks.verified.get(userId) : undefined) }));
vi.mock('@/lib/notify/service', async (original) => ({
  ...(await original<typeof import('@/lib/notify/service')>()),
  getMailer: (): Mailer => ({
    kind: 'fake',
    from: 'TWINGS <no-reply@example.com>',
    async send(message) {
      mocks.sent.push(message);
      return { ok: true, id: 'fake' };
    },
  }),
}));
vi.mock('@/lib/brands/concierge-slack', () => ({ notifySlackBrandConcierge: async () => ({ sent: false }) }));

const rooms = await import('@/app/api/brand-rooms/messages/route');
const workspace = await import('@/app/api/brand-workspace/route');

const fetcher: typeof fetch = async (input, init) => rooms.POST(new NextRequest(new URL(String(input), 'http://localhost:3000'), init as never));
const workspacePost = (operation: string, input: unknown) =>
  workspace.POST(new NextRequest('http://localhost:3000/api/brand-workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

let w: SendWorld;
let file: string;
beforeEach(async () => {
  w = await sendWorld();
  resetFreeIntelRateLimits();
  mocks.after.length = 0;
  mocks.sent.length = 0;
  mocks.verified.clear();
  mocks.sql = w.f.sql;
  mocks.viewer = as(w.f.ids.editor);
  openSend(w.f.orgId);
  openInvites();
  file = (await imageResult(w, w.f.projectId)).outputId;
});
afterEach(async () => {
  await closeWorld(w);
  mocks.sql = null;
  mocks.viewer = null;
});

describe('the typed client against the real routes', () => {
  it('post with invites, lookup, the statuses, the mail after the commit, and the acceptance route delivering the line', async () => {
    vi.stubEnv('BRAND_ORG_INVITE_EMAIL', 'on');
    const client = sendInviteTransport(w.f.orgId, fetcher);
    const looked = await client.lookup('Route.Person@Example.com');
    expect(looked).toEqual({ ok: true, email: 'route.person@example.com', status: 'invitable', member: null });
    const sent = await client.post({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Over HTTP', invites: ['route.person@example.com'] });
    if (!sent.ok) throw new Error(JSON.stringify(sent));
    expect(sent.invited).toEqual([{ email: 'route.person@example.com', result: 'invited', memberId: null, token: expect.any(String), mailState: 'sent' }]);
    expect(mocks.sent.map((m) => m.to)).toEqual(['route.person@example.com']);
    // A viewer: 403 forbidden; slice 4a's client keeps working.
    mocks.viewer = as(w.f.ids.viewer);
    expect(await sendInviteTransport(w.f.orgId, fetcher).post({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x', invites: ['a@example.com'] })).toEqual({ ok: false, code: 'forbidden' });
    const plain = await sendTransport(w.f.orgId, fetcher).post({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'plain' });
    expect(plain.ok && plain.message.invites).toEqual([]);
    // The acceptance route gives acceptBrandInvitation its hooks: the line reaches the new member.
    const invitee = await person(w.f.sql, 'route.person@example.com');
    mocks.verified.set(invitee, 'route.person@example.com');
    mocks.viewer = as(invitee);
    const accepted = await workspacePost('invitation.accept', { token: sent.invited![0]!.token });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, organizationId: w.f.orgId });
    const inbox = await sendTransport(w.f.orgId, fetcher).inbox();
    expect(inbox.ok && inbox.threads.map((t) => [t.rootId, t.unread, t.mentioned])).toEqual([[sent.thread.rootId, true, true]]);
  });

  it('429 invite_limit over the daily cap; 409 invite_refused naming the address; 400 invalid while closed (lookup included); offline when the network fails', async () => {
    await w.f.sql.query(
      `insert into brand_invites (organization_id, email, role, token_hash, expires_at, created_by, request_id)
         select $1, 'cap' || g || '@example.com', 'viewer', md5(g::text) || md5((g + 1000)::text), now() + interval '7 days', $2, gen_random_uuid() from generate_series(1, 20) g`,
      [w.f.orgId, w.f.ids.owner],
    );
    const response = await fetcher('/api/brand-rooms/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'send.post', input: { organizationId: w.f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x', invites: ['over@example.com'] } }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, code: 'invite_limit' });
    // 409 invite_refused, with the refused address, through the route and the typed client.
    await w.f.sql.query(
      `insert into brand_invites (organization_id, email, role, token_hash, expires_at, created_by, request_id, created_at)
         values ($1, 'held@example.com', 'editor', md5('held') || md5('held2'), now() + interval '7 days' - interval '2 days', $2, gen_random_uuid(), now() - interval '2 days')`,
      [w.f.orgId, w.f.ids.owner],
    );
    const refused = await fetcher('/api/brand-rooms/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'send.post', input: { organizationId: w.f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x', invites: ['held@example.com'] } }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ ok: false, code: 'invite_refused', refused: ['held@example.com'] });
    expect(await sendInviteTransport(w.f.orgId, fetcher).post({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x', invites: ['held@example.com'] })).toEqual({
      ok: false,
      code: 'invite_refused',
      refused: ['held@example.com'],
    });
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    const client = sendInviteTransport(w.f.orgId, fetcher);
    expect(await client.post({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'x', invites: ['a@example.com'] })).toEqual({ ok: false, code: 'invalid' });
    // Closed, the lookup does not exist: the unknown operation's answer, as on origin/main.
    expect(await client.lookup('a@example.com')).toEqual({ ok: false, code: 'invalid' });
    const offline = sendInviteTransport(w.f.orgId, async () => {
      throw new Error('network');
    });
    expect(await offline.lookup('a@example.com')).toEqual({ ok: false, code: 'offline' });
  });
});
