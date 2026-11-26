import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { ROOM_NOTICE_RULES, runRoomNoticePass, type RoomNoticePassDeps } from '@/lib/brand-rooms/notices';
import type { SendPosted } from '@/lib/brand-rooms/send-contracts';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { savePushSubscription } from '@/lib/notify/push';
import { testPushKeys } from '../../helpers/push';
import { fakePushSender, minutesFromNow } from '../notices/helpers';
import { as, closeWorld, imageResult, membersLine, ok, openSend, selfProject, sendWorld, staffViewer, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.4 and the coordinator's decisions 11–12: who hears about a members line.
 *  - Everyone a line names (but its writer) gets `mention`; on a project's members channel that is today's mention mail
 *    and push, word for word, opening the 알림함 on the thread (never a room); on an unfiled file's channel it is in-app
 *    only (no project to name, no sentence that fits).
 *  - A reply: the thread's other participants (root writer, everyone named in it, everyone who replied) get
 *    `member_reply`, in-app only; not the replier, not those named in this reply (they got `mention`), nobody else.
 *  - Never twice for one line and person; never staff who are not members; nothing for a bystander.
 *  - The notice rows carry their channel; the pass reads a members line as the members channel's (its own audience,
 *    never a team channel's read mark or bundle); a notice made before the file moved opens the thread after it.
 */
let w: SendWorld;
let mailer: FakeMailer;
beforeEach(async () => {
  w = await sendWorld();
  openSend(w.f.orgId);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://twings.app');
  vi.stubEnv('NOTIFY_TOKEN_SECRET', 'test-only-room-notice-secret-0000000000');
  mailer = createFakeMailer();
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);
const viewer = () => as(w.f.ids.viewer);
const output = (outputId: string) => ({ kind: 'output', outputId });
const send = (by: Viewer, file: Record<string, unknown>, body: string, mentions: string[] = []) => ok<SendPosted>(w, by, 'send.post', { requestId: randomUUID(), file, body, mentions });
const answer = (by: Viewer, rootId: string, body: string, mentions: string[] = []) => ok<SendPosted>(w, by, 'send.reply', { requestId: randomUUID(), rootId, body, mentions });
const pass = (deps: Partial<RoomNoticePassDeps> = {}) => runRoomNoticePass({ sql: w.f.sql, mailer, push: null, now: minutesFromNow(0), ...deps });
const roleOf = (id: string) => Object.entries(w.f.ids).find(([, v]) => v === id)?.[0] ?? id;

async function notices(messageId?: string) {
  return (
    await w.f.sql.query<{ recipient: string; kind: string; timing: string; state: string; skip_reason: string | null; push_state: string; channel: string | null; project_id: string | null }>(
      `select recipient_id::text as recipient, kind, timing, state, skip_reason, push_state, channel, project_id::text as project_id
         from brand_room_notices ${messageId ? 'where message_id = $1' : ''} order by kind, recipient_id`,
      messageId ? [messageId] : [],
    )
  )
    .rows.map((r) => ({ ...r, recipient: roleOf(r.recipient) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.recipient.localeCompare(b.recipient));
}

describe('who is told', () => {
  it('a send in a project: everyone named (not the writer) gets the mention mail and push, nobody else anything', async () => {
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    const sent = await send(owner(), file, '@editor @viewer @me', [w.f.ids.editor, w.f.ids.viewer, w.f.ids.owner]);
    expect(await notices(sent.message.id)).toEqual(
      ['editor', 'viewer']
        .map((recipient) => ({ recipient, kind: 'mention', timing: 'now', state: 'pending', skip_reason: null, push_state: 'pending', channel: `members:${w.f.projectId}`, project_id: w.f.projectId }))
        .sort((a, b) => (a.recipient < b.recipient ? -1 : 1)),
    );
    expect(ROOM_NOTICE_RULES.mention).toEqual({ email: 'now', push: true, actor: 'any' });
  });

  it('a send with no mention, or naming only the writer, tells nobody', async () => {
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    await send(owner(), file, 'Just filing this');
    await send(owner(), file, '@me', [w.f.ids.owner]);
    expect(await notices()).toEqual([]);
  });

  it('an unfiled file: the mention is in-app only (no project to name), no mail, no push', async () => {
    const sent = await send(owner(), output((await imageResult(w)).outputId), '@editor', [w.f.ids.editor]);
    expect(await notices(sent.message.id)).toEqual([
      { recipient: 'editor', kind: 'mention', timing: 'none', state: 'skipped', skip_reason: 'rule', push_state: 'none', channel: 'members', project_id: null },
    ]);
  });

  it('a reply: member_reply for the other participants, mention for those it names, nothing for the replier or a bystander', async () => {
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    // owner writes naming the editor; the viewer replies naming nobody; then the editor replies naming the owner.
    const sent = await send(owner(), file, '@editor', [w.f.ids.editor]);
    const first = await answer(viewer(), sent.thread.rootId, 'Agreed');
    expect(await notices(first.message.id)).toEqual(
      ['editor', 'owner'].map((recipient) => ({ recipient, kind: 'member_reply', timing: 'none', state: 'skipped', skip_reason: 'rule', push_state: 'none', channel: `members:${w.f.projectId}`, project_id: w.f.projectId })),
    );
    const second = await answer(editor(), sent.thread.rootId, '@owner done', [w.f.ids.owner]);
    expect((await notices(second.message.id)).map((n) => [n.recipient, n.kind])).toEqual([
      ['viewer', 'member_reply'],
      ['owner', 'mention'],
    ]);
    // A member who never took part hears nothing; staff who are not members never appear.
    const all = await notices();
    expect(all.some((n) => n.recipient === 'admin' || n.recipient === 'guest' || n.recipient === 'outsider')).toBe(false);
    // One row per line and person: the unique key and the planner agree.
    const keys = all.map((n) => `${n.recipient}:${n.kind}`);
    expect((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_notices group by message_id, recipient_id having count(*) > 1')).rows).toEqual([]);
    expect(keys.length).toBe(5);
  });

  it('staff who are members are told as members; a member removed since the line is not', async () => {
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'editor')", [w.f.orgId, w.f.ids.admin]);
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    const sent = await send(owner(), file, '@staff-member', [w.f.ids.admin]);
    expect((await notices(sent.message.id)).map((n) => n.recipient)).toEqual(['admin']);
    await w.f.sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [w.f.orgId, w.f.ids.admin]);
    await answer(editor(), sent.thread.rootId, 'Reply after removal');
    expect((await notices()).filter((n) => n.kind === 'member_reply').map((n) => n.recipient)).toEqual(['owner']);
  });
});

describe('the pass: mail and push for a members mention', () => {
  it('a mention in a project: today’s mention mail and push, word for word, opening the 알림함 on the thread', async () => {
    await w.f.sql.query("update profiles set display_name = 'Mina Park', locale = 'ko' where id = $1", [w.f.ids.owner]);
    await w.f.sql.query("update profiles set locale = 'ko' where id = $1", [w.f.ids.editor]);
    await savePushSubscription(w.f.sql, w.f.ids.editor, { endpoint: 'https://fcm.googleapis.com/fcm/send/editor-device', ...testPushKeys() }, null);
    const sender = fakePushSender();
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    const sent = await send(owner(), file, '@editor 이 컷 어때요?', [w.f.ids.editor]);
    const report = await pass({ push: sender });
    expect(report).toMatchObject({ mails: 1, sent: 1, pushes: 1 });
    const [mail] = mailer.sent;
    expect(mail!.to).toBe('editor@example.test');
    expect(mail!.subject).toBe('[Spring launch] Mina Park님이 불렀어요');
    expect(mail!.text).toContain('Mina Park님이 프로젝트 대화에서 불렀어요. 내용을 확인해 주세요.');
    expect(mail!.text).toContain('Mina Park: @editor 이 컷 어때요?');
    const link = `/brand/inbox?organizationId=${w.f.orgId}&thread=${sent.thread.rootId}`;
    expect(mail!.html).toContain(link.replace(/&/g, '&amp;'));
    expect(mail!.html).not.toContain('/brand/rooms');
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.message).toMatchObject({ title: '나를 불렀어요', body: '[Spring launch] Mina Park님이 불렀어요', url: link, tag: sent.thread.rootId });
  });

  it('nothing goes out for an unfiled mention or a member_reply; nothing ever to staff', async () => {
    const sender = fakePushSender();
    for (const id of [w.f.ids.owner, w.f.ids.editor, w.f.ids.viewer, w.f.ids.admin]) {
      await savePushSubscription(w.f.sql, id, { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, ...testPushKeys() }, null);
    }
    const sent = await send(owner(), output((await imageResult(w)).outputId), '@editor', [w.f.ids.editor]);
    await answer(viewer(), sent.thread.rootId, 'Reply');
    const report = await pass({ push: sender });
    expect(report).toMatchObject({ mails: 0, pushes: 0 });
    expect(mailer.sent).toEqual([]);
    expect(sender.calls).toEqual([]);
  });

  it('a members mention is never read as the team channel’s (its read mark, its bundle) and never joins a team mail', async () => {
    const file = output((await imageResult(w, w.f.projectId)).outputId);
    // The editor has read the team channel of the same project after the line: that must not skip the members mention.
    const sent = await send(owner(), file, '@editor', [w.f.ids.editor]);
    await w.f.sql.query("insert into brand_room_reads (organization_id, channel, user_id, last_read_at) values ($1, $2, $3, now() + interval '1 minute')", [w.f.orgId, w.f.projectId, w.f.ids.editor]);
    // And a team line naming nobody waits in the editor's team bundle.
    await w.f.sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'studio', 'text', 'Team news')`, [
      w.f.orgId,
      w.f.projectId,
      w.f.projectId,
      w.f.ids.admin,
    ]);
    const report = await runRoomNoticePass({ sql: w.f.sql, mailer, push: null, now: minutesFromNow(15) });
    expect(report.mails).toBe(1);
    expect(mailer.sent[0]!.html).toContain(`thread=${sent.thread.rootId}`);
  });

  it('a notice made before the file moved opens the same thread after it, with the new project’s name', async () => {
    const other = await selfProject(w, 'Autumn board');
    await w.f.sql.query("update profiles set locale = 'ko' where id = $1", [w.f.ids.editor]);
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), '@editor', [w.f.ids.editor]);
    const moved = await runStudioOperation(w.deps, owner(), 'project.move', { organizationId: w.f.orgId, projectId: other, jobIds: [run.jobId] });
    expect(moved.ok).toBe(true);
    expect((await notices(sent.message.id))[0]).toMatchObject({ channel: `members:${other}`, project_id: other });
    await pass();
    expect(mailer.sent[0]!.subject).toContain('[Autumn board]');
    expect(mailer.sent[0]!.html).toContain(`thread=${sent.thread.rootId}`);
  });

  it('moved to 미분류 before the pass: in-app only after all (no true {project}); 보내기 closed by then: nobody', async () => {
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), '@editor', [w.f.ids.editor]);
    expect((await runStudioOperation(w.deps, owner(), 'project.move', { organizationId: w.f.orgId, projectId: null, jobIds: [run.jobId] })).ok).toBe(true);
    await pass();
    expect(mailer.sent).toEqual([]);
    expect((await notices(sent.message.id))[0]).toMatchObject({ state: 'skipped', skip_reason: 'rule', channel: 'members', project_id: null });
    const again = await send(owner(), output((await imageResult(w, w.f.projectId)).outputId), '@editor again', [w.f.ids.editor]);
    vi.stubEnv('BRAND_SEND', 'off');
    await pass();
    expect(mailer.sent).toEqual([]);
    expect((await notices(again.message.id))[0]).toMatchObject({ state: 'skipped', skip_reason: 'no_access' });
  });

  it('a members line written straight into the table is still only its members’ (no notice is planned for staff)', async () => {
    const file = (await imageResult(w, w.f.projectId)).outputId;
    const root = await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: w.f.projectId, authorId: w.f.ids.owner, body: 'x', file: { kind: 'output', id: file } });
    const { enqueueNotices } = await import('@/lib/brand-rooms/notices');
    await enqueueNotices(w.f.sql, { type: 'member', organizationId: w.f.orgId, projectId: w.f.projectId, channel: `members:${w.f.projectId}`, messageId: root, rootId: root, actorId: w.f.ids.owner, mentions: [w.f.ids.admin, w.f.ids.guest, w.f.ids.editor], reply: false });
    expect((await notices(root)).map((n) => n.recipient)).toEqual(['editor']);
    // A channel that does not match the project is refused by the planner.
    await enqueueNotices(w.f.sql, { type: 'member', organizationId: w.f.orgId, projectId: w.f.projectId, channel: 'members', messageId: root, rootId: root, actorId: w.f.ids.owner, mentions: [w.f.ids.viewer], reply: false });
    expect((await notices(root)).map((n) => n.recipient)).toEqual(['editor']);
    expect(staffViewer(w).isAdmin).toBe(true);
    void runRoomOperation;
  });
});
