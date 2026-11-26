import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptBrandInvitation } from '@/lib/brands/workspace/service';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { loadRoomSummary } from '@/lib/brand-rooms/messages';
import { sendInviteAcceptHooks } from '@/lib/brand-rooms/send-invite';
import { SEND_LIMITS, type SendFileThreads, type SendInboxPage, type SendLookup, type SendPosted, type SendThreadPage } from '@/lib/brand-rooms/send-contracts';
import { as, closeWorld, code, imageResult, ok, openSend, sendWorld, type SendWorld } from '../send/helpers';
import { openInvites, person, recording } from './helpers';

/**
 * 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c): the invited address is personal data (decision 9), and the
 * picker's help says nothing about accounts outside this organization (decision 10).
 *  - In a line's answer only the line's writer and the organization's owners see the address; an editor or a viewer
 *    who did not write it sees the state only (the count is the number of chips).
 *  - Never in the bell, the notices or a log line, sending or accepting.
 *  - `send.lookup`: member (with id and name) / invitable / not_allowed; an unknown address and one with an account in
 *    another organization answer alike; rate-limited per person and organization.
 */
let w: SendWorld;
let file: string;
const ADDRESS = 'private.person@example.com';
beforeEach(async () => {
  w = await sendWorld();
  resetFreeIntelRateLimits();
  openSend(w.f.orgId);
  openInvites();
  file = (await imageResult(w, w.f.projectId)).outputId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetFreeIntelRateLimits();
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);
const viewer = () => as(w.f.ids.viewer);

describe('who sees the invited address (decision 9)', () => {
  it('the line’s writer and owners; never another editor or a viewer (they see the state)', async () => {
    // A second editor, who did not write the line.
    const colleague = await person(w.f.sql, 'colleague@example.test');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'editor')", [w.f.orgId, colleague]);
    const sent = await ok<SendPosted>(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'For the new one', mentions: [w.f.ids.viewer, colleague], invites: [ADDRESS] });
    const reply = await ok<SendPosted>(w, owner(), 'send.reply', { requestId: randomUUID(), rootId: sent.thread.rootId, body: 'Also', invites: ['second.person@example.com'] });
    expect(sent.message.invites).toEqual([{ state: 'pending', email: ADDRESS }]);
    const views = async (who: ReturnType<typeof as>) => {
      const thread = await ok<SendThreadPage>(w, who, 'send.thread', { rootId: sent.thread.rootId, markRead: false });
      const inbox = await ok<SendInboxPage>(w, who, 'send.inbox', {});
      const files = await ok<SendFileThreads>(w, who, 'send.file', { file: { kind: 'output', outputId: file } });
      return { thread, inbox, files };
    };
    // The writer of the root sees the root's address, not the reply's (an owner wrote that one).
    const asWriter = await views(editor());
    expect(asWriter.thread.thread.root.invites).toEqual([{ state: 'pending', email: ADDRESS }]);
    expect(asWriter.thread.replies[0]!.invites).toEqual([{ state: 'pending', email: null }]);
    // An owner sees both.
    const asOwner = await views(owner());
    expect(asOwner.thread.thread.root.invites).toEqual([{ state: 'pending', email: ADDRESS }]);
    expect(asOwner.thread.replies[0]!.invites).toEqual([{ state: 'pending', email: 'second.person@example.com' }]);
    expect(reply.message.invites).toEqual([{ state: 'pending', email: 'second.person@example.com' }]);
    // Another editor and a viewer (both named in the root): the state, never an address, in any answer.
    for (const who of [as(colleague), viewer()]) {
      const seen = await views(who);
      expect(seen.thread.thread.root.invites).toEqual([{ state: 'pending', email: null }]);
      expect(seen.thread.replies[0]!.invites).toEqual([{ state: 'pending', email: null }]);
      expect(JSON.stringify(seen)).not.toMatch(/private\.person|second\.person/);
    }
  });

  it('never in the bell, a notice, or a log line, sending, looking up or accepting', async () => {
    const logs: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
    const sent = await ok<SendPosted>(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Hello', mentions: [w.f.ids.owner, w.f.ids.viewer], invites: [ADDRESS] });
    await ok(w, editor(), 'send.lookup', { email: ADDRESS });
    expect(await code(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: `to ${ADDRESS}`, invites: [ADDRESS] })).toBe('invalid');
    for (const who of [owner(), editor(), viewer()]) {
      for (const view of ['all', 'mentions'] as const) {
        const summary = await loadRoomSummary({ sql: w.f.sql }, who, w.f.orgId, { bell: { media: w.deps.media, view } });
        expect(JSON.stringify(summary)).not.toMatch(/private\.person/);
      }
    }
    const invitee = await person(w.f.sql, ADDRESS);
    const accepted = await acceptBrandInvitation({ sql: w.f.sql, verifiedEmail: ADDRESS, sendInvites: sendInviteAcceptHooks() }, as(invitee), { token: sent.invited![0]!.token! });
    expect(accepted.ok).toBe(true);
    const notices = (await w.f.sql.query('select row_to_json(n)::text as row from brand_room_notices n')).rows.map((r) => String(r.row));
    expect(notices.length).toBeGreaterThan(0);
    for (const row of notices) expect(row).not.toMatch(/private\.person/);
    expect(JSON.stringify(logs)).not.toMatch(/private\.person/);
  });
});

describe('send.lookup (decision 10)', () => {
  it('member (id and name) for an active member; invitable for anything else; an account elsewhere answers like an unknown address', async () => {
    const elsewhere = await person(w.f.sql, 'has.account@example.com');
    const otherOrg = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other brand', elsewhere, randomUUID()]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrg, elsewhere]);
    const removed = await person(w.f.sql, 'removed@example.com');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'editor', 'revoked')", [w.f.orgId, removed]);
    expect(await ok<SendLookup>(w, editor(), 'send.lookup', { email: ' Viewer@Example.TEST ' })).toEqual({ ok: true, email: 'viewer@example.test', status: 'member', member: { id: w.f.ids.viewer, name: 'viewer' } });
    const unknown = await ok<SendLookup>(w, editor(), 'send.lookup', { email: 'nobody.at.all@example.com' });
    const account = await ok<SendLookup>(w, editor(), 'send.lookup', { email: 'has.account@example.com' });
    const gone = await ok<SendLookup>(w, editor(), 'send.lookup', { email: 'removed@example.com' });
    const guest = await ok<SendLookup>(w, editor(), 'send.lookup', { email: 'guest@example.test' });
    for (const answer of [unknown, account, gone, guest]) expect({ ...answer, email: '' }).toEqual({ ok: true, email: '', status: 'invitable', member: null });
    // The same statements, too: nothing outside this organization's memberships is read.
    const texts: string[][] = [[], []];
    const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
    await runRoomOperation({ sql: recording(w.f.sql, texts[0]!), media: w.deps.media }, editor(), 'send.lookup', { organizationId: w.f.orgId, email: 'nobody.else@example.com' });
    await runRoomOperation({ sql: recording(w.f.sql, texts[1]!), media: w.deps.media }, editor(), 'send.lookup', { organizationId: w.f.orgId, email: 'has.account@example.com' });
    expect(texts[0]).toEqual(texts[1]);
    expect(texts[0]!.filter((t) => /profiles/.test(t) && !/brand_memberships/.test(t) && !/where id = \$1$/.test(t))).toEqual([]);
  });

  it('a viewer gets member or not_allowed; closed, not_allowed with nothing read; 보내기 closed, invalid; a bad address, invalid', async () => {
    expect((await ok<SendLookup>(w, viewer(), 'send.lookup', { email: 'owner@example.test' })).status).toBe('member');
    expect(await ok<SendLookup>(w, viewer(), 'send.lookup', { email: 'new@example.com' })).toEqual({ ok: true, email: 'new@example.com', status: 'not_allowed', member: null });
    expect((await ok<SendLookup>(w, as(w.f.ids.owner), 'send.lookup', { email: 'new@example.com' })).status).toBe('invitable');
    for (const bad of ['not an address', '', 'a@b']) expect(await code(w, editor(), 'send.lookup', { email: bad })).toBe('invalid');
    expect(await code(w, editor(), 'send.lookup', { email: 'new@example.com', role: 'editor' })).toBe('invalid');
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    const texts: string[] = [];
    const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
    const closed = await runRoomOperation({ sql: recording(w.f.sql, texts), media: w.deps.media }, editor(), 'send.lookup', { organizationId: w.f.orgId, email: 'owner@example.test' });
    expect(closed.result).toEqual({ ok: true, email: 'owner@example.test', status: 'not_allowed', member: null });
    expect(texts.some((t) => /lower\(p\.email\)/.test(t))).toBe(false);
    vi.stubEnv('BRAND_SEND', 'off');
    expect(await code(w, editor(), 'send.lookup', { email: 'new@example.com' })).toBe('invalid');
  });

  it(`at most ${SEND_LIMITS.lookupsPerMinute} lookups per person per organization a minute (rate_limited); another person is not slowed`, async () => {
    for (let i = 0; i < SEND_LIMITS.lookupsPerMinute; i += 1) expect(await code(w, editor(), 'send.lookup', { email: `try${i}@example.com` })).toBe('ok');
    expect(await code(w, editor(), 'send.lookup', { email: 'one.more@example.com' })).toBe('rate_limited');
    expect(await code(w, owner(), 'send.lookup', { email: 'one.more@example.com' })).toBe('ok');
  });
});
