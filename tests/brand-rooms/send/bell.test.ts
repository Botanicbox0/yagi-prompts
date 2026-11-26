import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ROOM_BELL_LIMITS, bellViewOf, type RoomBellThreadItem, type RoomSendBell, type RoomSummaryWithSendBell } from '@/lib/brand-rooms/bell';
import { loadRoomSummary, runRoomOperation } from '@/lib/brand-rooms/messages';
import type { SendInboxPage, SendPosted } from '@/lib/brand-rooms/send-contracts';
import {
  bellCanMarkRead,
  bellInboxCount,
  bellLineProjectLabel,
  bellLineText,
  bellMarkReadTarget,
  bellPollReduce,
  initialBellPollState,
  type BellState,
} from '@/components/brand-workspace/bell/model';
import { as, closeWorld, imageResult, membersLine, ok, openSend, sendWorld, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.4 and the coordinator's decision 13: the bell with 보내기 open.
 *  - Its lines are today's lines plus the caller's inbox threads (read ones too, as today's conversation lines), newest
 *    first, cut at `ROOM_BELL_LIMITS.items`; a thread line says whether the caller is named and opens the 알림함 on it.
 *  - Its number is today's counted lines plus the unread inbox threads; the rail's 알림함 row reads the same number.
 *  - The "멘션" view lists only the threads that name the caller; the number does not change with the view.
 *  - Additive: a deployed 3a client keeps working on the new answer (its pure model, unchanged, run on it here).
 *  - A fixed number of statements whatever the number of threads.
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
const output = (outputId: string) => ({ kind: 'output', outputId });
const send = (by: Viewer, file: Record<string, unknown>, body: string, mentions: string[] = []) => ok<SendPosted>(w, by, 'send.post', { requestId: randomUUID(), file, body, mentions });
async function bell(viewer = editor(), view: 'all' | 'mentions' = 'all', sql: SqlRunner = w.f.sql): Promise<RoomSendBell> {
  const answer = (await loadRoomSummary({ sql }, viewer, w.f.orgId, { bell: view === 'mentions' ? { media: w.deps.media, view } : { media: w.deps.media } })) as RoomSummaryWithSendBell;
  if (!answer.ok || !answer.bell || !('view' in answer.bell)) throw new Error(`no send bell: ${JSON.stringify(answer)}`);
  return answer.bell;
}
const threads = (b: RoomSendBell) => b.items.filter((item): item is RoomBellThreadItem => item.kind === 'thread');

describe('the bell with 보내기 open', () => {
  it('adds the caller’s threads to today’s lines, and their unread ones to today’s number', async () => {
    // Today's part: one unread team line in the team project.
    await w.f.sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'studio', 'text', 'Draft is up')`, [
      w.f.orgId,
      w.f.projectId,
      w.f.projectId,
      w.f.ids.admin,
    ]);
    const named = await send(owner(), output((await imageResult(w, w.f.projectId)).outputId), '@editor 확인 부탁', [w.f.ids.editor]);
    const mine = await send(editor(), output((await imageResult(w)).outputId), 'My own note');
    const b = await bell();
    expect(b.view).toBe('all');
    expect(b.unread).toBe(1 + 1); // the team conversation + the thread naming the editor (their own thread is read)
    expect(b.mentionsUnread).toBe(1);
    const lines = threads(b);
    expect(lines.map((l) => [l.rootId, l.unread, l.mentioned])).toEqual([
      [mine.thread.rootId, false, false],
      [named.thread.rootId, true, true],
    ]);
    const line = lines.find((l) => l.rootId === named.thread.rootId)!;
    expect(line).toMatchObject({
      id: `thread:${named.thread.rootId}`,
      kind: 'thread',
      projectId: w.f.projectId,
      projectTitle: 'Spring launch',
      title: null,
      line: '@editor 확인 부탁',
      version: null,
      openNotes: 0,
      unreadCount: 0,
      href: `/brand/inbox?organizationId=${w.f.orgId}&thread=${named.thread.rootId}`,
      actorName: 'owner',
      file: { available: true, kind: 'image' },
    });
    expect(line.thumbUrl).toBe(line.file.url);
    // The rail's 알림함 row reads the very same number (the 3a client's own rule).
    expect(bellInboxCount(b)).toBe(b.unread);
    // The newest line first, today's lines included.
    expect(b.items.map((i) => i.at)).toEqual([...b.items.map((i) => i.at)].sort().reverse());
    expect(b.items.some((i) => i.kind === 'conversation' && i.projectId === w.f.projectId)).toBe(true);
    // Opening the thread clears it from the number at the next poll.
    await ok(w, editor(), 'send.thread', { rootId: named.thread.rootId });
    expect((await bell()).unread).toBe(1);
  });

  it('the "멘션" view: only the threads that name the caller; the number stays the bell’s', async () => {
    const named = await send(owner(), output((await imageResult(w)).outputId), '@editor', [w.f.ids.editor]);
    await send(editor(), output((await imageResult(w)).outputId), 'Mine');
    const all = await bell();
    const mentions = await bell(editor(), 'mentions');
    expect(mentions.view).toBe('mentions');
    expect(mentions.items.map((i) => i.id)).toEqual([`thread:${named.thread.rootId}`]);
    expect(mentions.unread).toBe(all.unread);
    expect(mentions.mentionsUnread).toBe(1);
    expect(bellViewOf(new URLSearchParams('bell=1&view=mentions'))).toBe('mentions');
    for (const query of ['bell=1', 'bell=1&view=MENTIONS', 'bell=1&view=all', 'bell=1&view=']) expect(bellViewOf(new URLSearchParams(query))).toBe('all');
  });

  it('is cut at its limit with `more`, and counts every unread thread beyond the cut', async () => {
    const file = (await imageResult(w)).outputId;
    for (let i = 0; i < ROOM_BELL_LIMITS.items + 5; i += 1) {
      await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.owner, body: `T${i}`, file: { kind: 'output', id: file }, mentions: [w.f.ids.editor], at: new Date(Date.UTC(2026, 10, 20, 9, i)).toISOString() });
    }
    const b = await bell();
    expect(b.items).toHaveLength(ROOM_BELL_LIMITS.items);
    expect(b.more).toBe(true);
    expect(b.unread).toBe(ROOM_BELL_LIMITS.items + 5);
    // The inbox and the bell agree on the unread number.
    expect((await ok<SendInboxPage>(w, editor(), 'send.inbox', {})).unread).toBe(b.unread);
  });

  it('asks the database a fixed number of times whatever the number of threads', async () => {
    const file = (await imageResult(w)).outputId;
    const recorded = async (): Promise<number> => {
      const texts: string[] = [];
      const wrap = (inner: SqlRunner): SqlRunner => ({
        query: (text, params) => {
          texts.push(text);
          return inner.query(text, params);
        },
        transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
      });
      await bell(editor(), 'all', wrap(w.f.sql));
      return texts.length;
    };
    await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.owner, body: 'first', file: { kind: 'output', id: file }, mentions: [w.f.ids.editor] });
    await bell();
    const few = await recorded();
    for (let i = 0; i < 12; i += 1) {
      const root = await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.owner, body: `T${i}`, file: { kind: 'output', id: file }, mentions: [w.f.ids.editor] });
      await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.viewer, body: 'r', file: { kind: 'output', id: file }, parentId: root, mentions: [w.f.ids.owner] });
    }
    expect(await recorded()).toBe(few);
  });

  it('a project guest and a member of another organization get no thread line; another organization’s threads never show', async () => {
    const other = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', w.f.ids.owner, randomUUID()]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [other, w.f.ids.editor]);
    const theirs = (await imageResult(w, null, other)).outputId;
    await membersLine(w.f.sql, { organizationId: other, projectId: null, authorId: w.f.ids.editor, body: 'THEIR LINE', file: { kind: 'output', id: theirs }, mentions: [w.f.ids.editor] });
    await send(owner(), output((await imageResult(w)).outputId), '@editor', [w.f.ids.editor]);
    expect(JSON.stringify(await bell())).not.toContain('THEIR LINE');
    const guest = (await loadRoomSummary({ sql: w.f.sql }, as(w.f.ids.guest), w.f.orgId, { bell: { media: w.deps.media } })) as RoomSummaryWithSendBell;
    expect(guest.ok && guest.bell).toBeFalsy();
  });
});

describe('the deployed 3a client on the new answer (its own model, unchanged)', () => {
  it('keeps polling, counts the new number, draws a thread line as a conversation line, and offers no wrong mark', async () => {
    await send(owner(), output((await imageResult(w, w.f.projectId)).outputId), '@editor 확인 부탁', [w.f.ids.editor]);
    await send(owner(), output((await imageResult(w)).outputId), '@editor unfiled', [w.f.ids.editor]);
    const b = await bell();
    // The poll machine accepts the answer and keeps going.
    let machine = bellPollReduce(initialBellPollState(), { type: 'activate', organizationId: w.f.orgId }).state;
    machine = bellPollReduce(machine, { type: 'answer', organizationId: w.f.orgId, seq: machine.seq, result: { ok: true, bell: b as unknown as BellState } }).state;
    expect(machine).toMatchObject({ active: true, stopped: false, inflight: false });
    expect(bellInboxCount(machine.bell)).toBe(2);
    const copy = { alertStoryboard: 'sb {version}', alertReview: 'rv {version}', alertReviewNotes: 'rvn', generalHint: 'GENERAL HINT', noMessages: 'NO MESSAGES' };
    const [unfiled, filed] = threads(b);
    // Text: the thread's newest line. Mark read: never offered for a thread (its channel is not a room channel).
    expect(bellLineText(filed as never, copy)).toBe('@editor 확인 부탁');
    expect(bellCanMarkRead(filed as never)).toBe(false);
    expect(bellMarkReadTarget(filed as never)).toBeNull();
    // The project label: a filed file's project title. An unfiled file has no project: a 3a client labels it with the
    // general channel's name. This is why BRAND_SEND stays off until the 4b screen ships (the slice 4a contract).
    expect(bellLineProjectLabel(filed!, 'GENERAL')).toBe('Spring launch');
    expect(bellLineProjectLabel(unfiled!, 'GENERAL')).toBe('GENERAL');
  });
});

it('a send through the route answers 200 with no team notice (the members line is not the team’s)', async () => {
  const sent = await runRoomOperation({ sql: w.f.sql, media: w.deps.media }, owner(), 'send.post', { organizationId: w.f.orgId, requestId: randomUUID(), file: output((await imageResult(w)).outputId), body: 'x' });
  expect(sent.result.ok).toBe(true);
  expect(sent.notice).toBeNull();
});
