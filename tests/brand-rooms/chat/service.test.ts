import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { postRoomEvent } from '@/lib/brand-rooms/events';
import {
  loadRoomMessages,
  loadRoomSummary,
  refThreadCounts,
  roomFileVerdict,
  runRoomOperation,
  staffDeleteMessage,
  staffLoadRoomMessages,
  staffMarkRead,
  staffRoomChannels,
  staffRoomOverview,
  staffSendMessage,
  type RoomMessageDeps,
} from '@/lib/brand-rooms/messages';
import type { RoomMessage, RoomRefPage, RoomStreamPage, RoomThreadPage } from '@/lib/brand-rooms/message-contracts';
import { memoryStaging, pngBytes, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §4 and §9 — the conversation service against a real (PGlite) database: who may
 * read and write which channel, threads one level deep, refs kept inside their project, mentions limited
 * to people of the room, the per-member rate limit, read marks and unread counts, the earlier project
 * conversation as read-only history, files checked by their bytes, event lines that never break their
 * caller, and the team side.
 */
let f: StudioFixture;
let deps: RoomMessageDeps & { media: ReturnType<typeof createMemoryMediaStore>; staging: ReturnType<typeof memoryStaging> };

beforeEach(async () => {
  f = await studioFixture();
  deps = { sql: f.sql, media: createMemoryMediaStore(), staging: memoryStaging() };
});
afterEach(async () => {
  await f.db.close();
});

const as = (userId: string) => viewerOf(userId);
const send = (userId: string, input: Record<string, unknown>) =>
  runRoomOperation(deps, as(userId), 'message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'hello', ...input });
const sent = async (userId: string, input: Record<string, unknown> = {}): Promise<RoomMessage> => {
  const { result } = await send(userId, input);
  expect(result).toMatchObject({ ok: true });
  return (result as { message: RoomMessage }).message;
};
const stream = async (userId: string, query: Record<string, string> = {}) =>
  (await loadRoomMessages(deps, as(userId), { organizationId: f.orgId, projectId: f.projectId, ...query })) as RoomStreamPage;

async function seedStoryboard(sql: SqlRunner, projectId: string): Promise<{ board: string; frame: string }> {
  const board = (
    await sql.query<{ id: string }>(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, title, created_role) values ($1, $2, gen_random_uuid(), 'Spring film', 'studio') returning id`,
      [f.orgId, projectId],
    )
  ).rows[0]!.id;
  const frame = (
    await sql.query<{ id: string }>(
      `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, description, storage_key) values ($1, $2, 2, 'ready', 'close up', $3) returning id`,
      [board, f.orgId, (await deps.media.put(await pngBytes(8, 8), 'image/png')).key],
    )
  ).rows[0]!.id;
  return { board, frame };
}

describe('room conversation service', () => {
  it('lets every seated person talk, shows authors, and keeps the stream oldest first', async () => {
    const owner = await sent(f.ids.owner, { body: 'First line' });
    const viewer = await sent(f.ids.viewer, { body: 'A viewer may talk' });
    const guest = await sent(f.ids.guest, { body: 'The invited guest too' });
    expect(owner).toMatchObject({ authorRole: 'brand', mine: true, authorName: 'owner', channel: f.projectId, kind: 'text' });
    const page = await stream(f.ids.editor);
    expect(page.ok).toBe(true);
    expect(page.messages.map((m) => m.id)).toEqual([owner.id, viewer.id, guest.id]);
    expect(page.messages.every((m) => !m.mine)).toBe(true);
    expect(page.title).toBe('Spring launch');
    expect(page.people.map((p) => p.name)).toEqual(expect.arrayContaining(['owner', 'editor', 'viewer', 'guest']));
    expect(page.canPin).toBe(true);
    expect((await stream(f.ids.viewer)).canPin).toBe(false);
  });

  it('closes the general channel to a project guest and every channel to an outsider', async () => {
    const general = { organizationId: f.orgId, projectId: 'general' };
    expect(await loadRoomMessages(deps, as(f.ids.guest), general)).toEqual({ ok: false, code: 'not_found' });
    expect((await runRoomOperation(deps, as(f.ids.guest), 'message.send', { ...general, requestId: randomUUID(), body: 'x' })).result).toEqual({ ok: false, code: 'not_found' });
    expect(await loadRoomMessages(deps, as(f.ids.outsider), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'not_found' });
    expect(await loadRoomMessages(deps, viewerOf(null as unknown as string), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'sign_in_required' });
    // A project the guest was not invited to is not there for them.
    const other = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id) values ($1, $2, 'Autumn', 'Autumn line', 'studio', $3, $4)`,
      [other, f.orgId, f.ids.owner, randomUUID()],
    );
    expect(await loadRoomMessages(deps, as(f.ids.guest), { organizationId: f.orgId, projectId: other })).toEqual({ ok: false, code: 'not_found' });
    expect((await loadRoomMessages(deps, as(f.ids.viewer), { organizationId: f.orgId, projectId: other })).ok).toBe(true);
    // A project the brand cannot see yet has no channel.
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [other]);
    expect(await loadRoomMessages(deps, as(f.ids.owner), { organizationId: f.orgId, projectId: other })).toEqual({ ok: false, code: 'not_found' });
    const members = (await loadRoomMessages(deps, as(f.ids.owner), general)) as RoomStreamPage;
    expect(members.ok && members.people.some((p) => p.role === 'guest')).toBe(false);
  });

  it('is idempotent per request id and refuses the same id in another channel', async () => {
    const requestId = randomUUID();
    const first = await send(f.ids.owner, { requestId, body: 'once' });
    const again = await send(f.ids.owner, { requestId, body: 'once' });
    expect((again.result as { message: RoomMessage }).message.id).toBe((first.result as { message: RoomMessage }).message.id);
    expect(first.notice).not.toBeNull();
    expect(again.notice).toBeNull();
    const elsewhere = await runRoomOperation(deps, as(f.ids.owner), 'message.send', { organizationId: f.orgId, projectId: 'general', requestId, body: 'once' });
    expect(elsewhere.result).toEqual({ ok: false, code: 'conflict' });
  });

  it('keeps threads one level deep and counts replies on the parent', async () => {
    const root = await sent(f.ids.owner, { body: 'Can we see v2 by Friday?' });
    const reply = await sent(f.ids.editor, { body: 'Yes', parentId: root.id });
    expect((await send(f.ids.owner, { body: 'deeper', parentId: reply.id })).result).toEqual({ ok: false, code: 'invalid' });
    const page = await stream(f.ids.owner);
    expect(page.messages.map((m) => m.id)).toEqual([root.id]);
    expect(page.messages[0]).toMatchObject({ replyCount: 1 });
    const thread = (await loadRoomMessages(deps, as(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId, thread: root.id })) as RoomThreadPage;
    expect(thread.parent.id).toBe(root.id);
    expect(thread.replies.map((r) => r.id)).toEqual([reply.id]);
    // A thread of another channel is not reachable through this one.
    const general = await runRoomOperation(deps, as(f.ids.owner), 'message.send', { organizationId: f.orgId, projectId: 'general', requestId: randomUUID(), body: 'hi' });
    const generalId = (general.result as { message: RoomMessage }).message.id;
    expect(await loadRoomMessages(deps, as(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId, thread: generalId })).toEqual({ ok: false, code: 'not_found' });
    expect((await send(f.ids.owner, { body: 'cross', parentId: generalId })).result).toEqual({ ok: false, code: 'not_found' });
  });

  it('edits and deletes only your own lines; owners and editors pin, viewers do not', async () => {
    const mine = await sent(f.ids.viewer, { body: 'typo' });
    const op = (userId: string, operation: string, input: Record<string, unknown>) =>
      runRoomOperation(deps, as(userId), operation, { organizationId: f.orgId, projectId: f.projectId, messageId: mine.id, ...input }).then((o) => o.result);
    expect(await op(f.ids.owner, 'message.edit', { body: 'not yours' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(f.ids.viewer, 'message.edit', { body: 'fixed' })).toMatchObject({ ok: true, message: { body: 'fixed', edited: true } });
    expect(await op(f.ids.viewer, 'message.pin', { pinned: true })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(f.ids.editor, 'message.pin', { pinned: true })).toMatchObject({ ok: true, message: { pinned: true } });
    expect((await stream(f.ids.viewer)).pinned.map((m) => m.id)).toEqual([mine.id]);
    expect(await op(f.ids.owner, 'message.delete', {})).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(f.ids.viewer, 'message.delete', {})).toEqual({ ok: true });
    const after = await stream(f.ids.viewer);
    expect(after.messages).toEqual([]);
    expect(after.pinned).toEqual([]);
    const audit = (await f.sql.query<{ deleted_by: string; body: string }>('select deleted_by, body from brand_room_messages where id = $1', [mine.id])).rows[0]!;
    expect(audit).toEqual({ deleted_by: f.ids.viewer, body: 'fixed' });
  });

  it('toggles reactions per person and reports them on the line', async () => {
    const line = await sent(f.ids.owner);
    const react = (userId: string, emoji: string) =>
      runRoomOperation(deps, as(userId), 'reaction.toggle', { organizationId: f.orgId, projectId: f.projectId, messageId: line.id, emoji }).then((o) => o.result);
    await react(f.ids.owner, 'heart');
    expect(await react(f.ids.viewer, 'heart')).toMatchObject({ ok: true, reactions: [{ emoji: 'heart', count: 2, mine: true }] });
    expect(await react(f.ids.viewer, 'heart')).toMatchObject({ ok: true, reactions: [{ emoji: 'heart', count: 1, mine: false }] });
    expect(await react(f.ids.viewer, 'fire')).toEqual({ ok: false, code: 'invalid' });
  });

  it('keeps mentions to people of the room and only a brand may call the team', async () => {
    const line = await sent(f.ids.owner, { body: '@editor @viewer look', mentions: [f.ids.editor, f.ids.outsider, f.ids.viewer], mentionsTeam: true });
    expect(new Set(line.mentions)).toEqual(new Set([f.ids.editor, f.ids.viewer]));
    expect(line.mentionsTeam).toBe(true);
    const team = await staffSendMessage(deps, { ...as(f.ids.admin), isAdmin: true }, { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'On it', mentionsTeam: true });
    expect(team).toMatchObject({ ok: true, message: { authorRole: 'studio', mentionsTeam: false } });
  });

  it('limits a member to twenty lines a minute', async () => {
    for (let i = 0; i < 20; i += 1) await sent(f.ids.editor, { body: `line ${i}` });
    expect((await send(f.ids.editor, { body: 'one too many' })).result).toEqual({ ok: false, code: 'rate_limited' });
    expect((await send(f.ids.owner, { body: 'someone else' })).result).toMatchObject({ ok: true });
  });

  it('pages back in time and polls changes since a cursor', async () => {
    const lines: RoomMessage[] = [];
    for (let i = 0; i < 5; i += 1) {
      lines.push(await sent(f.ids.owner, { body: `line ${i}` }));
      await f.sql.query("update brand_room_messages set created_at = now() - ($2::int * interval '1 minute') where id = $1", [lines[i]!.id, 10 - i]);
    }
    const first = await stream(f.ids.editor, { limit: '2' });
    expect(first.messages.map((m) => m.body)).toEqual(['line 3', 'line 4']);
    expect(first.hasMore).toBe(true);
    const older = await stream(f.ids.editor, { limit: '2', before: first.messages[0]!.createdAt });
    expect(older.messages.map((m) => m.body)).toEqual(['line 1', 'line 2']);
    const cursor = first.cursor;
    await f.sql.query("update brand_room_messages set updated_at = updated_at - interval '1 hour' where organization_id = $1", [f.orgId]);
    await runRoomOperation(deps, as(f.ids.owner), 'message.edit', { organizationId: f.orgId, projectId: f.projectId, messageId: lines[1]!.id, body: 'line 1 edited' });
    const fresh = await sent(f.ids.viewer, { body: 'new' });
    const poll = await stream(f.ids.editor, { since: cursor });
    expect(poll.messages.map((m) => m.id).sort()).toEqual([lines[1]!.id, fresh.id].sort());
    expect(poll.cursor >= cursor).toBe(true);
  });

  it('counts unread lines per channel until the read mark, never your own', async () => {
    await sent(f.ids.owner, { body: 'one' });
    await sent(f.ids.owner, { body: 'two' });
    await sent(f.ids.editor, { body: 'mine' });
    const summary = await loadRoomSummary(deps, as(f.ids.editor), f.orgId);
    expect(summary).toMatchObject({ ok: true, unread: 2 });
    const project = summary.ok ? summary.channels.find((c) => c.projectId === f.projectId) : null;
    expect(project).toMatchObject({ title: 'Spring launch', unread: 2, lastLine: 'mine' });
    expect(summary.ok && summary.channels[0]!.projectId).toBeNull();
    const read = await runRoomOperation(deps, as(f.ids.editor), 'channel.read', { organizationId: f.orgId, projectId: f.projectId });
    expect(read.result).toMatchObject({ ok: true });
    expect(await loadRoomSummary(deps, as(f.ids.editor), f.orgId)).toMatchObject({ ok: true, unread: 0 });
    expect((await stream(f.ids.editor)).lastReadAt).not.toBeNull();
    const guest = await loadRoomSummary(deps, as(f.ids.guest), f.orgId);
    expect(guest.ok && guest.channels.map((c) => c.projectId)).toEqual([f.projectId]);
  });

  it('shows the earlier project conversation as read-only history at the start', async () => {
    await f.sql.query(
      `insert into brand_messages (organization_id, project_id, body, author_role, created_by, request_id) values ($1, $2, 'Old brief question', 'brand', $3, $4)`,
      [f.orgId, f.projectId, f.ids.owner, randomUUID()],
    );
    const page = await stream(f.ids.viewer);
    expect(page.legacy).toMatchObject([{ authorRole: 'brand', body: 'Old brief question', authorName: 'owner' }]);
    const summary = await loadRoomSummary(deps, as(f.ids.viewer), f.orgId);
    expect(summary.ok && summary.channels.find((c) => c.projectId === f.projectId)?.lastLine).toBe('Old brief question');
  });

  it('keeps a ref inside its project, shows its card, and lists a cut thread', async () => {
    const { board, frame } = await seedStoryboard(f.sql, f.projectId);
    const ref = { kind: 'storyboard', storyboardId: board, frameId: frame };
    const line = await sent(f.ids.owner, { body: 'Brighter here', ref });
    expect(line.ref).toMatchObject({ available: true, title: 'Spring film', version: 1, cut: 3 });
    expect(line.ref?.thumbUrl).toMatch(/^\/api\/brand-studio\/media\/st\//);
    const reply = await sent(f.ids.editor, { body: 'Agreed', parentId: line.id });
    const cut = (await loadRoomMessages(deps, as(f.ids.guest), { organizationId: f.orgId, projectId: f.projectId, ref: `storyboard:${board}:${frame}` })) as RoomRefPage;
    expect(cut.messages.map((m) => m.id)).toEqual([line.id, reply.id]);
    const whole = (await loadRoomMessages(deps, as(f.ids.guest), { organizationId: f.orgId, projectId: f.projectId, ref: `storyboard:${board}` })) as RoomRefPage;
    expect(whole.messages).toHaveLength(2);
    expect(await refThreadCounts(f.sql, f.orgId, [`storyboard:${board}:${frame}`])).toEqual({ [`storyboard:${board}:${frame}`]: 2 });
    // A storyboard of another project cannot be pointed at from this channel.
    const other = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id) values ($1, $2, 'Autumn', 'Autumn line', 'studio', $3, $4)`,
      [other, f.orgId, f.ids.owner, randomUUID()],
    );
    const elsewhere = await seedStoryboard(f.sql, other);
    expect((await send(f.ids.owner, { ref: { kind: 'storyboard', storyboardId: elsewhere.board } })).result).toEqual({ ok: false, code: 'not_found' });
    expect((await send(f.ids.owner, { ref: { kind: 'review', reviewId: randomUUID() } })).result).toEqual({ ok: false, code: 'not_found' });
    expect(
      (await runRoomOperation(deps, as(f.ids.owner), 'message.send', { organizationId: f.orgId, projectId: 'general', requestId: randomUUID(), body: 'x', ref })).result,
    ).toEqual({ ok: false, code: 'invalid' });
  });

  it('posts event lines that never break the caller, inside or outside a transaction', async () => {
    const { board } = await seedStoryboard(f.sql, f.projectId);
    await f.sql.transaction(async (tx) => {
      await postRoomEvent(tx, { organizationId: f.orgId, projectId: f.projectId, event: 'storyboard_shared', ref: { kind: 'storyboard', storyboardId: board }, actorId: f.ids.admin, actorRole: 'studio', detail: { title: 'Spring film', version: 2 } });
      // A bad project inside the same transaction: rolled back alone, the transaction carries on.
      await postRoomEvent(tx, { organizationId: f.orgId, projectId: randomUUID(), event: 'storyboard_shared', ref: { kind: 'storyboard', storyboardId: board }, actorId: null, actorRole: 'studio' });
      await tx.query('select 1');
    });
    await postRoomEvent(f.sql, { organizationId: f.orgId, projectId: f.projectId, event: 'review_approved', ref: { kind: 'review', reviewId: randomUUID() }, actorId: randomUUID(), actorRole: 'brand' });
    await postRoomEvent(f.sql, { organizationId: f.orgId, projectId: f.projectId, event: 'nonsense' as never, ref: { kind: 'review', reviewId: randomUUID() }, actorId: null, actorRole: 'brand' });
    const page = await stream(f.ids.viewer);
    expect(page.messages.map((m) => [m.kind, m.event, m.authorRole])).toEqual([
      ['event', 'storyboard_shared', 'system'],
      ['event', 'review_approved', 'system'],
    ]);
    expect(page.messages[0]).toMatchObject({ detail: { title: 'Spring film', version: 2 }, ref: { available: true, title: 'Spring film' } });
    // The review it names does not exist: the card shows, without anything about it.
    expect(page.messages[1]!.ref).toMatchObject({ available: false, title: null, thumbUrl: null });
  });

  it('checks a file by its bytes before it joins a message', async () => {
    const reserve = await runRoomOperation(deps, as(f.ids.viewer), 'attachment.reserve', {
      organizationId: f.orgId,
      projectId: f.projectId,
      name: 'look.png',
      mime: 'image/png',
      size: 10,
    });
    expect(reserve.result).toMatchObject({ ok: true, direct: false });
    const stagingKey = (reserve.result as { stagingKey: string }).stagingKey;
    expect(stagingKey).toContain(f.orgId);
    const bytes = await pngBytes(30, 20);
    await deps.staging.putStaging(stagingKey, bytes, 'image/png');
    const complete = (input: Record<string, unknown>, userId = f.ids.viewer) =>
      runRoomOperation(deps, as(userId), 'attachment.complete', { organizationId: f.orgId, projectId: f.projectId, stagingKey, name: 'look.png', mime: 'image/png', size: bytes.byteLength, ...input }).then((o) => o.result);
    expect(await complete({}, f.ids.editor)).toEqual({ ok: false, code: 'not_found' });
    expect(await complete({ size: bytes.byteLength + 1 })).toEqual({ ok: false, code: 'invalid' });
    expect(await complete({ mime: 'application/pdf' })).toEqual({ ok: false, code: 'unsupported_file' });
    const done = await complete({});
    expect(done).toMatchObject({ ok: true, attachment: { kind: 'image', mime: 'image/png', width: 30, height: 20, name: 'look.png' } });
    const attachment = (done as { attachment: { key: string; size: number } }).attachment;
    const line = await sent(f.ids.viewer, { body: '', attachments: [{ key: attachment.key, name: 'look.png', size: attachment.size, width: 30, height: 20 }] });
    expect(line.attachments).toMatchObject([{ kind: 'image', name: 'look.png', url: expect.stringContaining(attachment.key) }]);
    expect(
      (await runRoomOperation(deps, as(f.ids.viewer), 'attachment.reserve', { organizationId: f.orgId, projectId: f.projectId, name: 'big.mp4', mime: 'video/mp4', size: 26 * 1024 * 1024 })).result,
    ).toEqual({ ok: false, code: 'file_too_large' });
  });

  it('reads documents by their signatures', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(roomFileVerdict(enc('%PDF-1.7 hello'), 'application/pdf')).toEqual({ ok: true, mime: 'application/pdf' });
    expect(roomFileVerdict(enc('not a pdf'), 'application/pdf')).toMatchObject({ ok: false });
    expect(roomFileVerdict(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toMatchObject({ ok: true });
    expect(roomFileVerdict(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'application/x-hwp')).toMatchObject({ ok: true });
    expect(roomFileVerdict(enc('이름,수량\n병,3\n'), 'text/csv')).toMatchObject({ ok: true });
    expect(roomFileVerdict(new Uint8Array([0x61, 0, 0x62]), 'text/plain')).toMatchObject({ ok: false });
    expect(roomFileVerdict(enc('<svg/>'), 'image/svg+xml')).toMatchObject({ ok: false, code: 'unsupported_file' });
  });

  it('lets the team read every channel, reply as the team, take lines down and keep its own unread count', async () => {
    const admin = { ...as(f.ids.admin), isAdmin: true };
    const question = await sent(f.ids.owner, { body: 'When is the first cut?' });
    expect(await staffLoadRoomMessages(deps, as(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
    const page = (await staffLoadRoomMessages(deps, admin, { organizationId: f.orgId, projectId: f.projectId })) as RoomStreamPage;
    expect(page).toMatchObject({ ok: true, team: true, canPin: true });
    expect(page.messages.map((m) => m.id)).toEqual([question.id]);
    let overview = await staffRoomOverview(deps, admin);
    expect(overview.ok && overview.channels).toMatchObject([{ organizationId: f.orgId, channel: f.projectId, teamUnread: 1, lastRole: 'brand' }]);
    expect(await staffMarkRead(deps, admin, { organizationId: f.orgId, projectId: f.projectId })).toMatchObject({ ok: true });
    overview = await staffRoomOverview(deps, admin);
    expect(overview.ok && overview.channels[0]!.teamUnread).toBe(0);
    await sent(f.ids.owner, { body: 'And the second?' });
    const reply = await staffSendMessage(deps, admin, { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'Friday', parentId: question.id });
    expect(reply).toMatchObject({ ok: true, message: { authorRole: 'studio', parentId: question.id } });
    const channels = await staffRoomChannels(deps, admin, f.orgId);
    expect(channels.ok && channels.channels.map((c) => c.channel)).toEqual(['general', f.projectId]);
    expect(await staffDeleteMessage(deps, admin, { organizationId: f.orgId, projectId: f.projectId, messageId: question.id })).toEqual({ ok: true });
    // The brand sees the thread head as deleted, its reply still there.
    const brandView = await stream(f.ids.owner);
    expect(brandView.messages.find((m) => m.id === question.id)).toMatchObject({ deleted: true, body: '', replyCount: 1 });
  });
});
