import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ROOM_LIMITS } from '@/lib/brand-rooms/message-contracts';
import { SEND_LIMITS, sendThreadHref, type SendFileThreads, type SendInboxPage, type SendPeople, type SendPosted, type SendThreadPage } from '@/lib/brand-rooms/send-contracts';
import { as, closeWorld, code, imageResult, libraryPicture, membersLine, ok, op, openSend, selfProject, sendWorld, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.3–§8.4 and the coordinator's decisions 5, 6, 8–10, 14–16: sending, replying, reading.
 *  - A send's project and channel come from the FILE (its stored project; none = `members`); a client-supplied project
 *    or channel is refused; a file the sender cannot open, a deleted one and another organization's answer like a
 *    made-up id. A send with no mention is allowed.
 *  - Mentions name active members only (the writer included); anyone else refuses the line, one answer for all.
 *  - The rooms' own limits: body length, mentions per line, the send rate (shared with the team channels).
 *  - Replies are one level, in the root's channel, carry the root's file ref; a root on a team channel or of another
 *    organization is not found.
 *  - "나에게 온 것", case by case; unread per person and thread; opening marks only that thread for only that person;
 *    "모두 읽음"; paging returns every thread once across pages, ties on the timestamp included.
 *  - The members list, a file's threads, a deleted file's card.
 */
let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
  openSend(w.f.orgId);
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);
const viewer = () => as(w.f.ids.viewer);
const output = (outputId: string) => ({ kind: 'output', outputId });

async function send(by: Viewer, file: Record<string, unknown>, body = 'Look at this', mentions: string[] = [], extra: Record<string, unknown> = {}): Promise<SendPosted> {
  return ok<SendPosted>(w, by, 'send.post', { requestId: randomUUID(), file, body, mentions, ...extra });
}
async function answer(by: Viewer, rootId: string, body = 'Answer', mentions: string[] = []): Promise<SendPosted> {
  return ok<SendPosted>(w, by, 'send.reply', { requestId: randomUUID(), rootId, body, mentions });
}
const inbox = (by: Viewer, input: Record<string, unknown> = {}) => ok<SendInboxPage>(w, by, 'send.inbox', input);
const line = (sql: SqlRunner, id: string) =>
  sql.query<{ project_id: string | null; channel: string; parent_id: string | null; ref_key: string; ref: unknown; author_role: string; mentions: string[] }>(
    'select project_id::text as project_id, channel, parent_id::text as parent_id, ref_key, ref, author_role, mentions::text[] as mentions from brand_room_messages where id = $1',
    [id],
  ).then((r) => r.rows[0]!);

describe('send.post: the file decides where', () => {
  it('a file filed in a team project, in an own project, and an unfiled file and library entry', async () => {
    const own = await selfProject(w);
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [output((await imageResult(w, w.f.projectId)).outputId), w.f.projectId],
      [output((await imageResult(w, own)).outputId), own],
      [output((await imageResult(w)).outputId), null],
      [{ kind: 'asset', assetId: await libraryPicture(w, own) }, own],
      [{ kind: 'asset', assetId: await libraryPicture(w) }, null],
    ];
    for (const [file, projectId] of cases) {
      const sent = await send(owner(), file);
      const row = await line(w.f.sql, sent.message.id);
      expect(row, JSON.stringify(file)).toMatchObject({ project_id: projectId, channel: projectId ? `members:${projectId}` : 'members', parent_id: null, author_role: 'brand' });
      expect(row.ref_key).toBe(file.kind === 'output' ? `output:${file.outputId}` : `asset:${file.assetId}`);
      expect(sent.thread.file).toMatchObject({ available: true, kind: 'image', ref: file });
      // The card shows the project members are shown (a team project the brand sees, an own active project).
      expect(sent.thread.file.project?.id ?? null).toBe(projectId);
      expect(sent.message).toMatchObject({ rootId: sent.message.id, parentId: null, mine: true, body: 'Look at this', mentions: [] });
      expect(sent.thread).toMatchObject({ replyCount: 0, mentioned: false, unread: false });
    }
  });

  it('a client-supplied project or channel is refused; nothing is written', async () => {
    const file = output((await imageResult(w)).outputId);
    for (const extra of [{ projectId: w.f.projectId }, { channel: `members:${w.f.projectId}` }, { brandProjectId: w.f.projectId }, { parentId: randomUUID() }, { mentionsTeam: true }, { attachments: [] }]) {
      expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'x', ...extra }), JSON.stringify(extra)).toBe('invalid');
    }
    expect((await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where channel like 'members%'")).rows[0]!.n).toBe(0);
  });

  it('a file the sender cannot open, a deleted one and another organization’s answer exactly like a made-up id', async () => {
    const other = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', w.f.ids.owner, randomUUID()]);
    const theirs = (await imageResult(w, null, other)).outputId;
    const theirAsset = await libraryPicture(w, null, other);
    const deleted = (await imageResult(w)).outputId;
    await w.f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [deleted]);
    const removedRun = await imageResult(w);
    await w.f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [removedRun.jobId]);
    const fill = await imageResult(w);
    await w.f.sql.query(`update brand_studio_jobs set params = params || '{"purpose":"fill"}'::jsonb where id = $1`, [fill.jobId]);
    const deletedAsset = await libraryPicture(w);
    await w.f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [deletedAsset]);
    for (const file of [output(randomUUID()), output(theirs), output(deleted), output(removedRun.outputId), output(fill.outputId), { kind: 'asset', assetId: theirAsset }, { kind: 'asset', assetId: deletedAsset }, { kind: 'asset', assetId: randomUUID() }]) {
      const { result } = await op(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'x' });
      expect(result, JSON.stringify(file)).toEqual({ ok: false, code: 'not_found' });
    }
  });

  it('mentions: active members only (every role, the writer too); anyone else refuses the whole line with one answer', async () => {
    const file = output((await imageResult(w)).outputId);
    const sent = await send(owner(), file, '@all', [w.f.ids.editor, w.f.ids.viewer, w.f.ids.owner]);
    expect(sent.message.mentions.map((m) => m.id).sort()).toEqual([w.f.ids.editor, w.f.ids.viewer, w.f.ids.owner].sort());
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'editor', 'revoked')", [w.f.orgId, w.f.ids.outsider]);
    for (const stranger of [w.f.ids.guest, w.f.ids.admin, w.f.ids.outsider, randomUUID()]) {
      expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'x', mentions: [w.f.ids.editor, stranger] }), stranger).toBe('invalid');
      expect(await code(w, owner(), 'send.reply', { requestId: randomUUID(), rootId: sent.thread.rootId, body: 'x', mentions: [stranger] }), stranger).toBe('invalid');
    }
    expect((await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where channel like 'members%'")).rows[0]!.n).toBe(1);
  });

  it('the rooms’ limits: body length, mentions per line, the per-minute rate shared with the team channels; idempotent on the request id', async () => {
    const file = output((await imageResult(w)).outputId);
    expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'x'.repeat(ROOM_LIMITS.bodyMax + 1) })).toBe('invalid');
    expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: '   ' })).toBe('invalid');
    expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'x', mentions: Array.from({ length: ROOM_LIMITS.mentionsMax + 1 }, () => randomUUID()) })).toBe('invalid');
    const requestId = randomUUID();
    const first = await ok<SendPosted>(w, owner(), 'send.post', { requestId, file, body: 'Once' });
    const again = await ok<SendPosted>(w, owner(), 'send.post', { requestId, file, body: 'Once' });
    expect(again.message.id).toBe(first.message.id);
    expect(await code(w, owner(), 'send.reply', { requestId, rootId: first.thread.rootId, body: 'reused' })).toBe('conflict');
    for (let i = 2; i < ROOM_LIMITS.messagesPerMinute; i += 1) await send(owner(), file, `Line ${i}`);
    await answer(owner(), first.thread.rootId, 'The 20th line');
    expect(await code(w, owner(), 'send.post', { requestId: randomUUID(), file, body: 'One too many' })).toBe('rate_limited');
    expect(await code(w, owner(), 'send.reply', { requestId: randomUUID(), rootId: first.thread.rootId, body: 'One too many' })).toBe('rate_limited');
    expect((await op(w, editor(), 'send.post', { requestId: randomUUID(), file, body: 'Someone else' })).result.ok).toBe(true);
  });
});

describe('send.reply: one level, in the root’s channel', () => {
  it('carries the root’s file ref and channel; a reply cannot be answered as a root', async () => {
    const own = await selfProject(w);
    const sent = await send(owner(), output((await imageResult(w, own)).outputId));
    const replied = await answer(editor(), sent.thread.rootId, 'Looks good', [w.f.ids.owner]);
    const row = await line(w.f.sql, replied.message.id);
    expect(row).toMatchObject({ project_id: own, channel: `members:${own}`, parent_id: sent.thread.rootId, ref_key: (await line(w.f.sql, sent.message.id)).ref_key });
    expect(row.ref).toEqual((await line(w.f.sql, sent.message.id)).ref);
    expect(replied.message).toMatchObject({ rootId: sent.thread.rootId, parentId: sent.thread.rootId, mine: true, mentions: [{ id: w.f.ids.owner }] });
    expect(replied.thread.replyCount).toBe(1);
    expect(await code(w, owner(), 'send.reply', { requestId: randomUUID(), rootId: replied.message.id, body: 'Nested' })).toBe('not_found');
  });

  it('a root on a team channel, of another organization, or made up: not_found, nothing written', async () => {
    const team = (
      await w.f.sql.query<{ id: string }>(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'studio', 'text', 'Team') returning id::text as id`, [
        w.f.orgId,
        w.f.projectId,
        w.f.projectId,
        w.f.ids.admin,
      ])
    ).rows[0]!.id;
    const general = (await w.f.sql.query<{ id: string }>(`insert into brand_room_messages (organization_id, channel, author_id, author_role, kind, body) values ($1, 'general', $2, 'brand', 'text', 'Q') returning id::text as id`, [w.f.orgId, w.f.ids.owner])).rows[0]!.id;
    const other = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', w.f.ids.owner, randomUUID()]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [other, w.f.ids.owner]);
    const foreign = await membersLine(w.f.sql, { organizationId: other, projectId: null, authorId: w.f.ids.owner, body: 'Theirs', file: { kind: 'output', id: (await imageResult(w, null, other)).outputId } });
    const before = (await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_messages')).rows[0]!.n;
    for (const rootId of [team, general, foreign, randomUUID()]) {
      for (const operation of ['send.reply', 'send.thread', 'send.read']) {
        const input = operation === 'send.reply' ? { requestId: randomUUID(), rootId, body: 'x' } : { rootId };
        expect(await code(w, owner(), operation, input), `${operation} ${rootId}`).toBe('not_found');
      }
    }
    expect((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_messages')).rows[0]!.n).toBe(before);
    expect((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_thread_reads')).rows[0]!.n).toBe(0);
  });
});

describe('"나에게 온 것": the inbox and unread', () => {
  it('mentioned in the root, mentioned in a reply, the author, a replier are in it; a bystander is not', async () => {
    const file = output((await imageResult(w)).outputId);
    // The owner writes the root naming the editor; the viewer replies naming nobody; then the owner replies naming the viewer.
    const sent = await send(owner(), file, '@editor see', [w.f.ids.editor]);
    await answer(viewer(), sent.thread.rootId, 'Nice');
    const other = await send(editor(), output((await imageResult(w)).outputId), 'No mentions');
    await answer(owner(), other.thread.rootId, 'Reply naming the viewer', [w.f.ids.viewer]);
    const ids = async (by: Viewer) => (await inbox(by)).threads.map((t) => t.rootId).sort();
    expect(await ids(owner())).toEqual([sent.thread.rootId, other.thread.rootId].sort()); // author of one, replier in the other
    expect(await ids(editor())).toEqual([sent.thread.rootId, other.thread.rootId].sort()); // named in one, author of the other
    expect(await ids(viewer())).toEqual([sent.thread.rootId, other.thread.rootId].sort()); // replier in one, named in a reply of the other
    // A fourth member who is in neither thread (a bystander) sees nothing in the inbox, but may still open them.
    const bystander = randomUUID();
    await w.f.sql.query('insert into auth.users (id) values ($1)', [bystander]).catch(() => undefined);
    await w.f.sql.query('insert into profiles (id, email) values ($1, $2)', [bystander, `${bystander}@example.test`]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'viewer')", [w.f.orgId, bystander]);
    expect(await ids(as(bystander))).toEqual([]);
    expect((await op(w, as(bystander), 'send.thread', { rootId: sent.thread.rootId })).result.ok).toBe(true);
    // The "멘션" view: named in the root or any reply.
    expect((await inbox(editor(), { view: 'mentions' })).threads.map((t) => t.rootId)).toEqual([sent.thread.rootId]);
    expect((await inbox(viewer(), { view: 'mentions' })).threads.map((t) => t.rootId)).toEqual([other.thread.rootId]);
    expect((await inbox(owner(), { view: 'mentions' })).threads).toEqual([]);
  });

  it('unread is per person and thread: opening marks only that thread for only that person', async () => {
    const a = await send(owner(), output((await imageResult(w)).outputId), 'A', [w.f.ids.editor, w.f.ids.viewer]);
    const b = await send(owner(), output((await imageResult(w)).outputId), 'B', [w.f.ids.editor, w.f.ids.viewer]);
    const unread = async (by: Viewer) => Object.fromEntries((await inbox(by)).threads.map((t) => [t.rootId, t.unread]));
    expect(await unread(editor())).toEqual({ [a.thread.rootId]: true, [b.thread.rootId]: true });
    expect((await inbox(editor())).unread).toBe(2);
    expect(await unread(owner())).toEqual({ [a.thread.rootId]: false, [b.thread.rootId]: false }); // the author's own lines are never unread
    const opened = await ok<SendThreadPage>(w, editor(), 'send.thread', { rootId: a.thread.rootId });
    expect(opened.thread.unread).toBe(false);
    expect(await unread(editor())).toEqual({ [a.thread.rootId]: false, [b.thread.rootId]: true });
    expect(await unread(viewer())).toEqual({ [a.thread.rootId]: true, [b.thread.rootId]: true });
    // `markRead: false` reads without marking (a poll of a hidden tab).
    await ok(w, viewer(), 'send.thread', { rootId: b.thread.rootId, markRead: false });
    expect((await unread(viewer()))[b.thread.rootId]).toBe(true);
    // A new reply by someone else makes it unread again, for the others only.
    await answer(owner(), a.thread.rootId, 'One more thing');
    expect((await unread(editor()))[a.thread.rootId]).toBe(true);
    expect((await unread(owner()))[a.thread.rootId]).toBe(false);
    // send.read marks one thread; a mark never moves backwards.
    const read = await ok<{ lastReadAt: string }>(w, editor(), 'send.read', { rootId: a.thread.rootId });
    const back = await ok<{ lastReadAt: string }>(w, editor(), 'send.read', { rootId: a.thread.rootId, at: '2020-01-01T00:00:00Z' });
    expect(back.lastReadAt).toBe(read.lastReadAt);
    expect((await w.f.sql.query<{ user_id: string }>('select user_id::text as user_id from brand_room_thread_reads where root_message_id = $1', [a.thread.rootId])).rows.map((r) => r.user_id)).toEqual([w.f.ids.editor]);
  });

  it('"모두 읽음" marks every unread thread of the caller’s inbox, and only theirs', async () => {
    for (let i = 0; i < 3; i += 1) await send(owner(), output((await imageResult(w)).outputId), `T${i}`, [w.f.ids.editor, w.f.ids.viewer]);
    const done = await ok<{ marked: number; more: boolean }>(w, editor(), 'send.read_all', {});
    expect(done).toEqual({ ok: true, marked: 3, more: false });
    expect((await inbox(editor())).unread).toBe(0);
    expect((await inbox(viewer())).unread).toBe(3);
    expect(await ok(w, editor(), 'send.read_all', {})).toEqual({ ok: true, marked: 0, more: false });
  });

  it('pages by last activity, every thread once, ties on the timestamp included', async () => {
    const at = '2026-11-20T09:00:00.000Z';
    const ids: string[] = [];
    const file = (await imageResult(w)).outputId;
    const total = SEND_LIMITS.inboxPage * 2 + 3;
    for (let i = 0; i < total; i += 1) {
      // Half of them share one instant exactly; the rest a microsecond apart.
      const when = i % 2 ? at : `2026-11-20T08:59:59.${String(999_999 - i).padStart(6, '0')}Z`;
      ids.push(await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.owner, body: `Thread ${i}`, file: { kind: 'output', id: file }, mentions: [w.f.ids.editor], at: when }));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: SendInboxPage = await inbox(editor(), cursor ? { cursor } : {});
      expect(page.threads.length).toBeLessThanOrEqual(SEND_LIMITS.inboxPage);
      seen.push(...page.threads.map((t) => t.rootId));
      cursor = page.next;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(total);
    expect(seen.sort()).toEqual([...ids].sort());
    expect(await code(w, editor(), 'send.inbox', { cursor: 'not-a-cursor' })).toBe('invalid');
    expect(await code(w, editor(), 'send.inbox', { cursor: Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000', randomUUID()])).toString('base64url') })).toBe('invalid');
  });
});

describe('reads: a thread, a file’s threads, the members list', () => {
  it('a thread is its root and replies, oldest first, with names and the file card; the bell link is mode-neutral', async () => {
    await w.f.sql.query("update profiles set display_name = 'Editor Lee' where id = $1", [w.f.ids.editor]);
    const sent = await send(owner(), { kind: 'asset', assetId: await libraryPicture(w) }, '@Editor Lee', [w.f.ids.editor]);
    await answer(editor(), sent.thread.rootId, 'First');
    await answer(owner(), sent.thread.rootId, 'Second');
    const page = await ok<SendThreadPage>(w, editor(), 'send.thread', { rootId: sent.thread.rootId });
    expect(page.replies.map((r) => r.body)).toEqual(['First', 'Second']);
    expect(page.thread.root.mentions).toEqual([{ id: w.f.ids.editor, name: 'Editor Lee' }]);
    expect(page.replies[0]).toMatchObject({ authorName: 'Editor Lee', mine: true });
    expect(page.thread).toMatchObject({ replyCount: 2, mentioned: true, unread: false, latest: { line: 'Second', mine: false } });
    expect(page.thread.file).toMatchObject({ available: true, kind: 'image', name: expect.any(String) });
    expect(sendThreadHref(w.f.orgId, sent.thread.rootId)).toBe(`/brand/inbox?organizationId=${w.f.orgId}&thread=${sent.thread.rootId}`);
  });

  it('a file’s threads, newest first; a deleted file keeps its threads and reads as gone; a made-up file is not_found', async () => {
    const { outputId } = await imageResult(w, w.f.projectId);
    const first = await send(owner(), output(outputId), 'First');
    const second = await send(editor(), output(outputId), 'Second');
    const threads = await ok<SendFileThreads>(w, viewer(), 'send.file', { file: output(outputId) });
    expect(threads.threads.map((t) => t.rootId)).toEqual([second.thread.rootId, first.thread.rootId]);
    expect(threads.file).toMatchObject({ available: true, project: { id: w.f.projectId, title: 'Spring launch' } });
    await w.f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [outputId]);
    const gone = await ok<SendFileThreads>(w, viewer(), 'send.file', { file: output(outputId) });
    expect(gone.file).toEqual({ ref: output(outputId), available: false, kind: null, name: null, url: null, thumbUrl: null, width: null, height: null, project: null });
    expect(gone.threads.map((t) => t.rootId)).toEqual([second.thread.rootId, first.thread.rootId]);
    expect((await inbox(owner())).threads.find((t) => t.rootId === first.thread.rootId)!.file.available).toBe(false);
    expect(await code(w, owner(), 'send.reply', { requestId: randomUUID(), rootId: first.thread.rootId, body: 'Still talking' })).toBe('ok');
    expect(await code(w, owner(), 'send.file', { file: output(randomUUID()) })).toBe('not_found');
    // A deleted (or internal) file of this organization nobody talked about says nothing about itself: the made-up id's answer.
    const quiet = (await imageResult(w)).outputId;
    await w.f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [quiet]);
    expect(await code(w, owner(), 'send.file', { file: output(quiet) })).toBe('not_found');
    const fill = await imageResult(w);
    await w.f.sql.query(`update brand_studio_jobs set params = params || '{"purpose":"fill"}'::jsonb where id = $1`, [fill.jobId]);
    expect(await code(w, owner(), 'send.file', { file: output(fill.outputId) })).toBe('not_found');
  });

  it('a send takes the organization row before it reads where the file is filed (ordered against a move)', async () => {
    const { outputId } = await imageResult(w, w.f.projectId);
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(text.replace(/\s+/g, ' '));
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
    const { result } = await runRoomOperation({ sql: wrap(w.f.sql), media: w.deps.media }, owner(), 'send.post', { organizationId: w.f.orgId, requestId: randomUUID(), file: output(outputId), body: 'x' });
    expect(result.ok).toBe(true);
    const lock = texts.findIndex((t) => /from brand_organizations where id = \$1 for key share/.test(t));
    const read = texts.findIndex((t) => /from brand_studio_outputs o/.test(t));
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
  });

  it('a project members are not shown is not named on a card (a team project the staff hid)', async () => {
    const { outputId } = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(outputId), 'In the team project');
    await w.f.sql.query('update brand_projects set client_visible = false where id = $1', [w.f.projectId]);
    const page = await ok<SendThreadPage>(w, owner(), 'send.thread', { rootId: sent.thread.rootId });
    expect(page.thread.file.project).toBeNull();
    expect(JSON.stringify(page)).not.toContain('Spring launch');
  });

  it('the members list: active members, every role, never guests or staff who are not members, the caller marked', async () => {
    await w.f.sql.query("update profiles set display_name = 'Owner Kim' where id = $1", [w.f.ids.owner]);
    const people = await ok<SendPeople>(w, viewer(), 'send.people', {});
    expect(people.people.map((p) => [p.id, p.role, p.me]).sort()).toEqual(
      [
        [w.f.ids.owner, 'owner', false],
        [w.f.ids.editor, 'editor', false],
        [w.f.ids.viewer, 'viewer', true],
      ].sort(),
    );
    expect(people.people.find((p) => p.id === w.f.ids.owner)!.name).toBe('Owner Kim');
    expect(JSON.stringify(people)).not.toMatch(new RegExp(`${w.f.ids.guest}|${w.f.ids.admin}|@`));
  });
});
