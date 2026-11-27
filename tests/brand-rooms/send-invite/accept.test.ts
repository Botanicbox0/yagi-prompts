import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { acceptBrandInvitation, cancelBrandInvitation } from '@/lib/brands/workspace/service';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { sendInviteAcceptHooks } from '@/lib/brand-rooms/send-invite';
import type { SendInboxPage, SendPosted, SendThreadPage } from '@/lib/brand-rooms/send-contracts';
import { as, closeWorld, code, libraryVideo, ok, openSend, selfProject, sendWorld, videoResult, type SendWorld } from '../send/helpers';
import { invitation, openInvites, person, recording, tokenOf, waiting } from './helpers';

/**
 * 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c), the acceptance side (decisions 7 and 8), through the
 * existing `acceptBrandInvitation` with the hooks the route gives it:
 *  - on acceptance every waiting line names the new member and tells them once by slice 4a's rule; the threads are in
 *    their 알림함, unread; the waiting rows are gone; a retried acceptance changes nothing more;
 *  - an editor's invitation is honoured only while 초대하고 보내기 is open, only while lines wait for it, only as a viewer,
 *    and only while that editor still holds an owner or editor seat;
 *  - a deleted line is not delivered; a moved file's line is, where it is now; another signed-in account is refused as
 *    today; a failure while delivering never fails the acceptance;
 *  - before accepting the invitee reads nothing of the line or the file;
 *  - expiry and withdrawal delete nothing: the chips read pending, expired or accepted.
 */
let w: SendWorld;
let file: string;
beforeEach(async () => {
  w = await sendWorld();
  openSend(w.f.orgId);
  openInvites();
  file = (await videoResult(w, w.f.projectId)).outputId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);

/** The invitee signs in with the invited address (the server's verified e-mail, as the route reads it). */
async function accept(viewer: Viewer, token: string, verifiedEmail: string | undefined) {
  return acceptBrandInvitation({ sql: w.f.sql, verifiedEmail, projectGuestBinding: false, roomLanding: false, sendInvites: sendInviteAcceptHooks() }, viewer, { token });
}

/** The token of the invitation a line just issued (from the writer's answer). */
async function sendInviting(viewer: Viewer, email: string, options: { file?: { kind: 'output'; outputId: string } | { kind: 'asset'; assetId: string }; body?: string } = {}) {
  const sent = await ok<SendPosted>(w, viewer, 'send.post', { requestId: randomUUID(), file: options.file ?? { kind: 'output', outputId: file }, body: options.body ?? 'Have a look', invites: [email] });
  return { sent, token: sent.invited![0]!.token };
}

const noticesOf = async (userId: string) =>
  (
    await w.f.sql.query<{ kind: string; message_id: string; timing: string; state: string; skip_reason: string | null; push_state: string; channel: string | null }>(
      'select kind, message_id::text as message_id, timing, state, skip_reason, push_state, channel from brand_room_notices where recipient_id = $1 order by created_at, message_id',
      [userId],
    )
  ).rows;
const waitingRows = async () => Number((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_pending_mentions')).rows[0]!.n);

describe('accepting delivers the waiting lines (decision 7)', () => {
  it('names the new member on every waiting line, tells them once by 4a’s rule, puts the threads in their 알림함 unread, and clears the rows', async () => {
    const first = await sendInviting(editor(), 'new@example.com');
    // A second line (an unfiled library entry, by the owner) waits for the same invitation.
    const asset = await libraryVideo(w);
    const second = await ok<SendPosted>(w, owner(), 'send.post', { requestId: randomUUID(), file: { kind: 'asset', assetId: asset }, body: 'And this one', invites: ['new@example.com'] });
    expect(second.invited![0]!.result).toBe('reused');
    const invitee = await person(w.f.sql, 'new@example.com');
    const accepted = await accept(as(invitee), first.token!, 'new@example.com');
    expect(accepted).toEqual({ ok: true, organizationId: w.f.orgId });
    expect((await w.f.sql.query("select role, status from brand_memberships where organization_id = $1 and user_id = $2", [w.f.orgId, invitee])).rows).toEqual([{ role: 'viewer', status: 'active' }]);
    for (const line of [first.sent.message.id, second.message.id]) {
      expect((await w.f.sql.query<{ mentions: string[] }>('select mentions::text[] as mentions from brand_room_messages where id = $1', [line])).rows[0]!.mentions).toContain(invitee);
    }
    // One mention notice per line. In a project's members channel: today's mention mail and push (4a's rule); an
    // unfiled file: in-app only.
    expect(await noticesOf(invitee)).toEqual(
      expect.arrayContaining([
        { kind: 'mention', message_id: first.sent.message.id, timing: 'now', state: 'pending', skip_reason: null, push_state: 'pending', channel: `members:${w.f.projectId}` },
        { kind: 'mention', message_id: second.message.id, timing: 'none', state: 'skipped', skip_reason: 'rule', push_state: 'none', channel: 'members' },
      ]),
    );
    expect(await noticesOf(invitee)).toHaveLength(2);
    expect(await waitingRows()).toBe(0);
    const inbox = await ok<SendInboxPage>(w, as(invitee), 'send.inbox', {});
    expect(inbox.threads.map((t) => [t.rootId, t.unread, t.mentioned])).toEqual(
      expect.arrayContaining([
        [first.sent.thread.rootId, true, true],
        [second.thread.rootId, true, true],
      ]),
    );
    expect(inbox.unread).toBe(2);
    // The writer's line no longer lists the invitation (it reached them).
    expect((await ok<SendThreadPage>(w, editor(), 'send.thread', { rootId: first.sent.thread.rootId, markRead: false })).thread.root.invites).toEqual([]);
    // A retried acceptance (a lost answer) changes nothing more.
    expect(await accept(as(invitee), first.token!, 'new@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
    expect(await noticesOf(invitee)).toHaveLength(2);
  });

  it('a reply that waited is delivered as a mention in that reply; the thread is theirs, unread', async () => {
    const root = (await ok<SendPosted>(w, owner(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Root' })).thread.rootId;
    const replied = await ok<SendPosted>(w, editor(), 'send.reply', { requestId: randomUUID(), rootId: root, body: 'Bringing someone in', invites: ['late@example.com'] });
    const invitee = await person(w.f.sql, 'late@example.com');
    expect((await accept(as(invitee), replied.invited![0]!.token!, 'late@example.com')).ok).toBe(true);
    expect(await noticesOf(invitee)).toEqual([expect.objectContaining({ kind: 'mention', message_id: replied.message.id })]);
    // Only the new member is told now: the thread's participants heard about the reply when it was written.
    expect(await w.f.sql.query('select count(*)::int as n from brand_room_notices where message_id = $1 and recipient_id <> $2', [replied.message.id, invitee]).then((r) => r.rows[0])).toEqual({ n: 1 });
    const inbox = await ok<SendInboxPage>(w, as(invitee), 'send.inbox', { view: 'mentions' });
    expect(inbox.threads.map((t) => [t.rootId, t.unread])).toEqual([[root, true]]);
  });

  it('a deleted line is not delivered (its row goes); a moved file’s line is, where it is now; the acceptance completes', async () => {
    const kept = await sendInviting(owner(), 'mover@example.com');
    const deleted = await ok<SendPosted>(w, owner(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Will be removed', invites: ['mover@example.com'] });
    await w.f.sql.query('update brand_room_messages set deleted_at = now() where id = $1', [deleted.message.id]);
    // Move the file (and with it its threads) to the brand's own project.
    const own = await selfProject(w);
    const run = (await w.f.sql.query<{ job_id: string }>('select job_id::text as job_id from brand_studio_outputs where id = $1', [file])).rows[0]!.job_id;
    const moved = await runStudioOperation(w.deps, owner(), 'project.move', { organizationId: w.f.orgId, projectId: own, jobIds: [run] });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    const invitee = await person(w.f.sql, 'mover@example.com');
    expect((await accept(as(invitee), kept.token!, 'mover@example.com')).ok).toBe(true);
    expect(await noticesOf(invitee)).toEqual([expect.objectContaining({ kind: 'mention', message_id: kept.sent.message.id, channel: `members:${own}` })]);
    expect((await w.f.sql.query<{ mentions: string[] }>('select mentions::text[] as mentions from brand_room_messages where id = $1', [deleted.message.id])).rows[0]!.mentions).not.toContain(invitee);
    expect(await waitingRows()).toBe(0);
  });

  it('another signed-in account (another address): refused as today (forbidden); nothing is delivered and the rows stay', async () => {
    const { token } = await sendInviting(owner(), 'intended@example.com');
    const stranger = await person(w.f.sql, 'stranger@example.com');
    expect(await accept(as(stranger), token!, 'stranger@example.com')).toEqual({ ok: false, code: 'forbidden' });
    expect(await waitingRows()).toBe(1);
    expect(await noticesOf(stranger)).toEqual([]);
    expect(await code(w, as(stranger), 'send.inbox', {})).toBe('not_found');
  });

  it('a failure while delivering never fails the acceptance: that part rolls back alone and is logged without any text', async () => {
    const { token } = await sendInviting(owner(), 'fragile@example.com');
    await w.f.db.exec(`create function test_refuse_mention() returns trigger language plpgsql as $$ begin raise exception 'refused fragile@example.com'; end $$;
      create trigger test_refuse_mention before update on brand_room_messages for each row execute function test_refuse_mention();`);
    const logs: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
    const invitee = await person(w.f.sql, 'fragile@example.com');
    expect(await accept(as(invitee), token!, 'fragile@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
    expect((await w.f.sql.query("select status from brand_memberships where organization_id = $1 and user_id = $2", [w.f.orgId, invitee])).rows).toEqual([{ status: 'active' }]);
    expect(await waitingRows()).toBe(1);
    expect(await noticesOf(invitee)).toEqual([]);
    expect(logs).toEqual([['[brand-send] invite_delivery_failed', JSON.stringify({ code: 'P0001' })]]);
    expect(JSON.stringify(logs)).not.toMatch(/example\.com|refused/);
  });
});

describe('an editor’s invitation (decision 1) and closed acceptance (decision 3)', () => {
  it('is honoured while open, lines waiting, as a viewer, with the editor still an owner or editor', async () => {
    const { token } = await sendInviting(editor(), 'by-editor@example.com');
    const invitee = await person(w.f.sql, 'by-editor@example.com');
    expect(await accept(as(invitee), token!, 'by-editor@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
  });

  it('is not honoured once the editor became a viewer or was removed (not_found), as an owner’s invitation dies with its owner', async () => {
    for (const change of ["update brand_memberships set role = 'viewer' where organization_id = $1 and user_id = $2", "update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2"]) {
      await w.f.sql.query("update brand_memberships set role = 'editor', status = 'active' where organization_id = $1 and user_id = $2", [w.f.orgId, w.f.ids.editor]);
      const email = `${randomUUID().slice(0, 8)}@example.com`;
      const { token } = await sendInviting(editor(), email);
      await w.f.sql.query(change, [w.f.orgId, w.f.ids.editor]);
      const invitee = await person(w.f.sql, email);
      expect(await accept(as(invitee), token!, email)).toEqual({ ok: false, code: 'not_found' });
    }
  });

  it('is not honoured while closed, nor without waiting lines, nor with another role (not_found); an owner’s is, and keeps its rows while closed', async () => {
    const byEditor = await sendInviting(editor(), 'closed-editor@example.com');
    const byOwner = await sendInviting(owner(), 'closed-owner@example.com');
    const a = await person(w.f.sql, 'closed-editor@example.com');
    const b = await person(w.f.sql, 'closed-owner@example.com');
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    expect(await accept(as(a), byEditor.token!, 'closed-editor@example.com')).toEqual({ ok: false, code: 'not_found' });
    expect(await accept(as(b), byOwner.token!, 'closed-owner@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
    // Closed: the line did not reach them and its row stays; reopened, the chip reads `accepted`.
    expect(await noticesOf(b)).toEqual([]);
    expect(await waitingRows()).toBe(2);
    openInvites();
    expect((await ok<SendThreadPage>(w, owner(), 'send.thread', { rootId: byOwner.sent.thread.rootId, markRead: false })).thread.root.invites).toEqual([{ state: 'accepted', email: 'closed-owner@example.com' }]);
    // Reopened: the editor's is honoured again.
    expect(await accept(as(a), byEditor.token!, 'closed-editor@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
    // No waiting line (an editor-made invitation the line was never attached to): not honoured.
    await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'bare@example.com', createdBy: w.f.ids.editor, token: tokenOf('bare') });
    const bare = await person(w.f.sql, 'bare@example.com');
    expect(await accept(as(bare), tokenOf('bare'), 'bare@example.com')).toEqual({ ok: false, code: 'not_found' });
    // Another role (an editor-made editor invitation written by hand): no line can wait for it (0202's guard), and it is
    // not honoured.
    const higher = await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'higher@example.com', role: 'editor', createdBy: w.f.ids.editor, token: tokenOf('higher') });
    await expect(waiting(w.f.sql, { organizationId: w.f.orgId, messageId: byEditor.sent.message.id, inviteId: higher })).rejects.toThrow(/not an organization viewer invitation/);
    const climber = await person(w.f.sql, 'higher@example.com');
    expect(await accept(as(climber), tokenOf('higher'), 'higher@example.com')).toEqual({ ok: false, code: 'not_found' });
    expect((await w.f.sql.query('select count(*)::int as n from brand_memberships where user_id = $1', [climber])).rows[0]).toEqual({ n: 0 });
  });
});

describe('the follow-up review (M1, L1, L2)', () => {
  /** A runner whose FIRST `information_schema` statement fails in the database (a missing relation), as a timeout would. */
  function failingFirstProbe(): { sql: typeof w.f.sql; failed: () => boolean } {
    let fired = false;
    const wrap = (inner: typeof w.f.sql): typeof w.f.sql => ({
      query: (text, params) => {
        if (!fired && /information_schema/.test(text)) {
          fired = true;
          return inner.query('select * from relation_that_does_not_exist_for_the_test');
        }
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    return { sql: wrap(w.f.sql), failed: () => fired };
  }

  it('M1: a database error in the open check never fails an acceptance (owner’s and editor’s invitations): the seat is granted, the answer is success', async () => {
    const { resetBrandSendProbe } = await import('@/lib/brand-rooms/members-schema');
    const { resetSpineProbe } = await import('@/lib/brand-studio/brand-projects');
    const logs: unknown[][] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void logs.push(args));
    for (const [sender, email] of [[owner(), 'm1.owner@example.com'], [editor(), 'm1.editor@example.com']] as const) {
      const { token } = await sendInviting(sender, email);
      const invitee = await person(w.f.sql, email);
      // The probes forgotten, so the acceptance's open check has to ask the database, and that statement fails.
      resetBrandSendProbe();
      resetSpineProbe();
      const failing = failingFirstProbe();
      const accepted = await acceptBrandInvitation({ sql: failing.sql, verifiedEmail: email, projectGuestBinding: false, roomLanding: false, sendInvites: sendInviteAcceptHooks() }, as(invitee), { token: token! });
      expect(failing.failed(), email).toBe(true);
      // The owner's invitation: accepted, the delivery step skipped. The editor's: its honour check failed closed
      // (not_found), never a 500.
      if (sender.userId === w.f.ids.owner) {
        expect(accepted).toEqual({ ok: true, organizationId: w.f.orgId });
        expect((await w.f.sql.query('select status from brand_memberships where organization_id = $1 and user_id = $2', [w.f.orgId, invitee])).rows).toEqual([{ status: 'active' }]);
      } else {
        expect(accepted).toEqual({ ok: false, code: 'not_found' });
      }
    }
    expect(JSON.stringify(logs)).not.toMatch(/example\.com|relation_that/);
  });

  it('L1: a demoted owner’s pre-issued invitation is not honoured through a line that reused it (보내기 did not create it)', async () => {
    const { createBrandInvitation } = await import('@/lib/brands/workspace/service');
    const { inviteRequestId } = await import('@/lib/brand-rooms/send-invite');
    // A second owner who will be demoted.
    const formerOwner = await person(w.f.sql, 'former.owner@example.test');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [w.f.orgId, formerOwner]);
    const lineRequest = randomUUID();
    // While an owner, they issue a viewer invitation from the members page with the request id 보내기 would derive.
    const pre = await createBrandInvitation({ sql: w.f.sql }, as(formerOwner), { organizationId: w.f.orgId, email: 'planted@example.com', role: 'viewer', requestId: inviteRequestId(lineRequest, 'planted@example.com') });
    if (!pre.ok) throw new Error(JSON.stringify(pre));
    // Demoted to editor; then they send a line with that request id naming that address: the line reuses the invitation.
    await w.f.sql.query("update brand_memberships set role = 'editor' where organization_id = $1 and user_id = $2", [w.f.orgId, formerOwner]);
    const line = await ok<SendPosted>(w, as(formerOwner), 'send.post', { requestId: lineRequest, file: { kind: 'output', outputId: file }, body: 'Planted', invites: ['planted@example.com'] });
    expect(line.invited![0]!.result).toBe('reused');
    const invitee = await person(w.f.sql, 'planted@example.com');
    // origin/main refuses it (its inviter is no longer an owner); so does this slice.
    expect(await accept(as(invitee), pre.token, 'planted@example.com')).toEqual({ ok: false, code: 'not_found' });
    expect((await w.f.sql.query('select count(*)::int as n from brand_memberships where user_id = $1', [invitee])).rows[0]).toEqual({ n: 0 });
  });

  it('L2: a waiting line the acceptance could not take reaches the member on their next inbox read, and on the bell’s, once; delivery skips locked lines', async () => {
    const { loadRoomSummary } = await import('@/lib/brand-rooms/messages');
    const first = await sendInviting(owner(), 'later.read@example.com');
    const second = await ok<SendPosted>(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Second', invites: ['later.read@example.com'] });
    const invitee = await person(w.f.sql, 'later.read@example.com');
    // The acceptance's delivery did not happen (closed at that moment, as a skipped or failed delivery leaves it).
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    expect((await accept(as(invitee), first.token!, 'later.read@example.com')).ok).toBe(true);
    openInvites();
    expect(await waitingRows()).toBe(2);
    expect(await noticesOf(invitee)).toEqual([]);
    // Their next inbox read delivers both lines before it is answered.
    const inbox = await ok<SendInboxPage>(w, as(invitee), 'send.inbox', {});
    expect(inbox.threads.map((t) => t.rootId).sort()).toEqual([first.sent.thread.rootId, second.thread.rootId].sort());
    expect(inbox.unread).toBe(2);
    expect(await waitingRows()).toBe(0);
    expect((await noticesOf(invitee)).map((n) => n.kind)).toEqual(['mention', 'mention']);
    // Once: another read adds nothing.
    await ok(w, as(invitee), 'send.inbox', {});
    expect(await noticesOf(invitee)).toHaveLength(2);
    // The bell does the same for a member who reads the bell first.
    const third = await sendInviting(owner(), 'bell.first@example.com');
    const bellReader = await person(w.f.sql, 'bell.first@example.com');
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    expect((await accept(as(bellReader), third.token!, 'bell.first@example.com')).ok).toBe(true);
    openInvites();
    const summary = await loadRoomSummary({ sql: w.f.sql }, as(bellReader), w.f.orgId, { bell: { media: w.deps.media } });
    expect(JSON.stringify(summary)).toContain(`thread:${third.sent.thread.rootId}`);
    expect(await noticesOf(bellReader)).toHaveLength(1);
    // Delivery takes only the lines nobody holds (`skip locked`), and leaves the others waiting.
    const texts: string[] = [];
    const fourth = await sendInviting(owner(), 'skip.locked@example.com');
    const locker = await person(w.f.sql, 'skip.locked@example.com');
    await acceptBrandInvitation({ sql: recording(w.f.sql, texts), verifiedEmail: 'skip.locked@example.com', sendInvites: sendInviteAcceptHooks() }, as(locker), { token: fourth.token! });
    expect(texts.some((t) => /for update of m skip locked$/.test(t))).toBe(true);
  });

  it('L2: a read with nothing left costs its savepoint, one read and the release, and never fails the read', async () => {
    const texts: string[] = [];
    const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
    const answer = await runRoomOperation({ sql: recording(w.f.sql, texts), media: w.deps.media }, owner(), 'send.inbox', { organizationId: w.f.orgId });
    expect(answer.result.ok).toBe(true);
    const leftovers = texts.filter((t) => /brand_send_invite_leftovers|accepted_by = \$2/.test(t));
    expect(leftovers).toEqual([
      'savepoint brand_send_invite_leftovers',
      expect.stringMatching(/^select distinct pm\.invite_id/),
      'release savepoint brand_send_invite_leftovers',
    ]);
    // A failing leftover read is rolled back alone: the inbox still answers.
    await w.f.db.exec(`alter table brand_room_pending_mentions rename to brand_room_pending_mentions_away`);
    try {
      expect((await runRoomOperation({ sql: w.f.sql, media: w.deps.media }, owner(), 'send.inbox', { organizationId: w.f.orgId })).result.ok).toBe(true);
    } finally {
      await w.f.db.exec(`alter table brand_room_pending_mentions_away rename to brand_room_pending_mentions`);
    }
  });
});

describe('what an editor’s line cannot do (the independent review’s findings)', () => {
  it('an editor’s invitation is not honoured for someone an owner removed after the line was sent (not_found); an owner’s still is', async () => {
    const byEditor = await sendInviting(editor(), 'was.here@example.com');
    const removed = await person(w.f.sql, 'was.here@example.com');
    // Between the line and the acceptance the person became a member and an owner removed them (written by hand: every
    // page that adds a member also withdraws this invitation; this is the acceptance's own wall).
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'editor', 'revoked')", [w.f.orgId, removed]);
    expect(await accept(as(removed), byEditor.token!, 'was.here@example.com')).toEqual({ ok: false, code: 'not_found' });
    expect((await w.f.sql.query('select status from brand_memberships where organization_id = $1 and user_id = $2', [w.f.orgId, removed])).rows).toEqual([{ status: 'revoked' }]);
    // The owner's own invitation (from the members page, which replaces the editor's) is honoured, as on origin/main.
    const fresh = await (await import('@/lib/brands/workspace/service')).createBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, email: 'was.here@example.com', role: 'viewer', requestId: randomUUID() });
    if (!fresh.ok) throw new Error(JSON.stringify(fresh));
    expect(await accept(as(removed), fresh.token, 'was.here@example.com')).toEqual({ ok: true, organizationId: w.f.orgId });
  });

  it('an invitation 보내기 did not issue is not brought back to life by an editor’s line that reused it', async () => {
    // An editor-made viewer invitation that did not come from 보내기 (written by hand: the members page never lets an
    // editor issue one; this stands for an owner's invitation whose owner has since become an editor).
    await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'elsewhere@example.com', createdBy: w.f.ids.editor, token: tokenOf('elsewhere') });
    const reused = await ok<SendPosted>(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Reusing it', invites: ['elsewhere@example.com'] });
    expect(reused.invited![0]!.result).toBe('reused');
    const invitee = await person(w.f.sql, 'elsewhere@example.com');
    expect(await accept(as(invitee), tokenOf('elsewhere'), 'elsewhere@example.com')).toEqual({ ok: false, code: 'not_found' });
  });

  it('a sender who lost their seat after it was read is refused once the organization row is held (forbidden)', async () => {
    const { planInvites, SendInviteDenied } = await import('@/lib/brand-rooms/send-invite');
    await w.f.sql.query("update brand_memberships set role = 'viewer' where organization_id = $1 and user_id = $2", [w.f.orgId, w.f.ids.editor]);
    const attempt = planInvites(w.f.sql, { organizationId: w.f.orgId, me: w.f.ids.editor, seat: { role: 'editor' } }, { invites: ['late.seat@example.com'], body: 'hi', mentions: [] });
    await expect(attempt).rejects.toBeInstanceOf(SendInviteDenied);
    await expect(attempt).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('an owner-role invitation (the team’s handover) is never reused: the address is refused, and no line waits for it', async () => {
    await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'handover@example.com', role: 'owner', createdBy: w.f.ids.admin, token: tokenOf('handover'), issuedByStudio: true });
    const { result } = await (await import('../send/helpers')).op(w, editor(), 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'For the new owner', invites: ['handover@example.com'] });
    expect(result).toEqual({ ok: false, code: 'invite_refused', refused: ['handover@example.com'] });
    expect(await waitingRows()).toBe(0);
  });
});

describe('before accepting, the invitee reads nothing (no leak of the members channel)', () => {
  it('every 보내기 door is not_found for them; the acceptance answer names no line or file; afterwards they read as any member', async () => {
    const { sent, token } = await sendInviting(owner(), 'curious@example.com', { body: 'SECRET-LINE' });
    const invitee = await person(w.f.sql, 'curious@example.com');
    const doors: Array<[string, Record<string, unknown>]> = [
      ['send.thread', { rootId: sent.thread.rootId }],
      ['send.file', { file: { kind: 'output', outputId: file } }],
      ['send.inbox', {}],
      ['send.read', { rootId: sent.thread.rootId }],
      ['send.read_all', {}],
      ['send.people', {}],
      ['send.lookup', { email: 'curious@example.com' }],
      ['send.reply', { requestId: randomUUID(), rootId: sent.thread.rootId, body: 'hi' }],
    ];
    for (const [operation, input] of doors) expect(await code(w, as(invitee), operation, input), operation).toBe('not_found');
    const accepted = await accept(as(invitee), token!, 'curious@example.com');
    expect(JSON.stringify(accepted)).not.toMatch(/SECRET-LINE|members|output|thread/);
    expect(accepted).toEqual({ ok: true, organizationId: w.f.orgId });
    const thread = await ok<SendThreadPage>(w, as(invitee), 'send.thread', { rootId: sent.thread.rootId });
    expect(thread.thread.root.body).toBe('SECRET-LINE');
    expect(thread.thread.mentioned).toBe(true);
  });
});

describe('expiry and withdrawal delete nothing (decision 8)', () => {
  it('the chips read pending, then expired (past its time, or cancelled by an owner); the rows stay', async () => {
    const a = await sendInviting(owner(), 'later@example.com');
    const b = await sendInviting(owner(), 'cancelled@example.com');
    const read = async (rootId: string) => (await ok<SendThreadPage>(w, owner(), 'send.thread', { rootId, markRead: false })).thread.root.invites;
    expect(await read(a.sent.thread.rootId)).toEqual([{ state: 'pending', email: 'later@example.com' }]);
    await w.f.sql.query("update brand_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where email = 'later@example.com'");
    expect(await read(a.sent.thread.rootId)).toEqual([{ state: 'expired', email: 'later@example.com' }]);
    const cancelId = (await w.f.sql.query<{ id: string }>("select id::text as id from brand_invites where email = 'cancelled@example.com'")).rows[0]!.id;
    expect((await cancelBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, invitationId: cancelId })).ok).toBe(true);
    expect(await read(b.sent.thread.rootId)).toEqual([{ state: 'expired', email: 'cancelled@example.com' }]);
    expect(await waitingRows()).toBe(2);
    // An expired invitation cannot be accepted (as today), and a new line for that address issues a new invitation.
    const late = await person(w.f.sql, 'later@example.com');
    expect(await accept(as(late), a.token!, 'later@example.com')).toEqual({ ok: false, code: 'not_found' });
    const again = await sendInviting(owner(), 'later@example.com');
    expect(again.sent.invited![0]!.result).toBe('invited');
  });

  it('an owner re-inviting the address from the members page replaces the invitation: the older line reads expired', async () => {
    const a = await sendInviting(editor(), 'replaced@example.com');
    const { createBrandInvitation } = await import('@/lib/brands/workspace/service');
    expect((await createBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, email: 'replaced@example.com', role: 'viewer', requestId: randomUUID() })).ok).toBe(true);
    expect((await ok<SendThreadPage>(w, editor(), 'send.thread', { rootId: a.sent.thread.rootId, markRead: false })).thread.root.invites).toEqual([{ state: 'expired', email: 'replaced@example.com' }]);
  });
});
